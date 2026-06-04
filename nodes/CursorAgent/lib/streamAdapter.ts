import type { InteractionUpdate } from '@cursor/sdk';

import {
	AssistantTimelineBuilder,
	flattenToolCallsFromTimeline,
	lastMarkdownFromTimeline,
	mergeThinkingFromTimeline,
} from './assistantTimeline';
import { embedCursorMessageMeta } from './cursorMessageMeta';
import { normalizeUserVisibleMarkdown } from './normalizeAgentMarkdown';
import {
	encodeCursorStreamPayload,
	extractToolIdentity,
	resolveToolLabel,
	sanitizeThinkingChunk,
	shouldShowToolInUi,
	shouldSuppressAssistantText,
	type CursorStreamPayload,
} from './cursorStreamProtocol';

/** 透传 Cursor SDK 原始事件（仅调试/兼容） */
export const CURSOR_SDK_MARKER = '__cursor_sdk__';

export type CursorSdkChannel = 'delta' | 'message';

export interface CursorSdkEnvelope {
	channel: CursorSdkChannel;
	data: Record<string, unknown>;
}

export function encodeCursorSdkChunk(envelope: CursorSdkEnvelope): string {
	return JSON.stringify({ [CURSOR_SDK_MARKER]: envelope });
}

export interface StreamSink {
	onBegin: () => void | Promise<void>;
	onText: (text: string) => void | Promise<void>;
	onStructured: (jsonContent: string) => void | Promise<void>;
	onEnd: () => void | Promise<void>;
}

/**
 * 按 timeline 顺序组装紧凑 __cursor__ 流事件；落库为 markdown + cursor_meta（与流式 UI 同序）。
 */
export class CursorStreamAssembler {
	private readonly builder = new AssistantTimelineBuilder();
	private readonly startedTools = new Set<string>();
	private thinkingStarted = false;
	private thinkingDurationMs?: number;
	private fallbackMarkdown = '';

	constructor(private readonly sink: StreamSink) {}

	async begin(): Promise<void> {
		await this.sink.onBegin();
	}

	async end(): Promise<void> {
		const final = normalizeUserVisibleMarkdown(this.getTextOutput());
		if (final) {
			await this.emit({ kind: 'text_replace', text: final });
		}
		await this.sink.onEnd();
	}

	setFinalResult(result?: string): void {
		if (result?.trim()) {
			this.fallbackMarkdown = result.trim();
		}
	}

	getTextOutput(): string {
		this.builder.finalize();
		let markdown = lastMarkdownFromTimeline(this.builder.blocks);
		markdown = normalizeUserVisibleMarkdown(markdown || this.fallbackMarkdown);
		if (!markdown) return '';

		const suggestions = this.builder.suggestions;
		if (suggestions.length) {
			markdown += `\n\n<next>\n${suggestions.map((s) => `- ${s}`).join('\n')}\n</next>`;
		}

		const toolCalls = flattenToolCallsFromTimeline(this.builder.blocks);
		if (toolCalls.length) {
			const payload = {
				toolCalls: toolCalls.map((t) => ({ ...t, done: true })),
			};
			markdown += `\n<cursor_meta>${JSON.stringify(payload)}</cursor_meta>`;
		}

		return markdown;
	}

	getOutput(): string {
		this.builder.finalize();
		const timeline = this.builder.blocks;
		let markdown = lastMarkdownFromTimeline(timeline);
		if (!markdown && this.fallbackMarkdown) {
			markdown = this.fallbackMarkdown;
		}
		markdown = normalizeUserVisibleMarkdown(markdown);
		const thinking = mergeThinkingFromTimeline(timeline);
		const hasTimelineThinking = timeline.some((b) => b.type === 'thinking');
		return embedCursorMessageMeta(markdown, {
			timeline,
			toolCalls: flattenToolCallsFromTimeline(timeline),
			thinkingDurationMs: this.thinkingDurationMs,
			thinking: hasTimelineThinking ? undefined : thinking || undefined,
			suggestions: this.builder.suggestions,
		});
	}

	async consumeDelta(update: InteractionUpdate): Promise<void> {
		switch (update.type) {
			case 'token-delta':
				return;
			case 'thinking-delta': {
				const chunk = sanitizeThinkingChunk(String(update.text ?? ''));
				if (!chunk) return;
				if (!this.thinkingStarted) {
					if (this.builder.hasOpenMarkdownWithContent()) {
						await this.emit({ kind: 'text_reset' });
					}
					this.thinkingStarted = true;
					this.builder.onThinkingStart();
					await this.emit({ kind: 'thinking_start' });
				}
				this.builder.onThinkingChunk(chunk);
				await this.emit({ kind: 'thinking_chunk', text: chunk });
				break;
			}
			case 'thinking-completed': {
				this.thinkingDurationMs = update.thinkingDurationMs;
				this.thinkingStarted = false;
				this.builder.onThinkingEnd(update.thinkingDurationMs);
				await this.emit({ kind: 'thinking_end', durationMs: update.thinkingDurationMs });
				break;
			}
			case 'text-delta': {
				const text = String(update.text ?? '');
				if (!text || shouldSuppressAssistantText(text)) return;
				this.builder.onResponseText(text);
				await this.emit({ kind: 'text', text });
				break;
			}
			case 'tool-call-started':
			case 'partial-tool-call':
				await this.handleToolStarted(String(update.callId ?? ''), update.toolCall);
				break;
			case 'tool-call-completed':
				await this.handleToolCompleted(String(update.callId ?? ''), update.toolCall);
				break;
			default:
				break;
		}
	}

	private async emit(payload: CursorStreamPayload): Promise<void> {
		const json = encodeCursorStreamPayload(payload);
		await this.sink.onStructured(json);
	}

	private async handleToolStarted(callId: string, toolCall: unknown): Promise<void> {
		if (!callId) return;
		const { name } = extractToolIdentity(toolCall);
		if (!shouldShowToolInUi(name)) return;
		if (this.startedTools.has(callId)) return;
		this.startedTools.add(callId);

		if (this.builder.hasOpenMarkdownWithContent()) {
			await this.emit({ kind: 'text_reset' });
		}

		const label = resolveToolLabel(name);
		this.builder.onToolStart({
			id: callId,
			label,
			rawName: name,
			done: false,
		});
		await this.emit({
			kind: 'tool_start',
			callId,
			name,
			label,
		});
	}

	private async handleToolCompleted(callId: string, toolCall: unknown): Promise<void> {
		if (!callId) return;
		const { name } = extractToolIdentity(toolCall);
		if (!shouldShowToolInUi(name)) return;
		if (!this.startedTools.has(callId)) return;

		this.builder.onToolEnd(callId);
		await this.emit({ kind: 'tool_end', callId, ok: true });
	}
}

/** @deprecated 调试透传；生产请用 CursorStreamAssembler */
export class CursorStreamPassthrough {
	private streamItems: string[] = [];
	private assistantText = '';

	constructor(private readonly sink: StreamSink) {}

	getOutput(): string {
		if (this.streamItems.length > 0) {
			return this.streamItems.join('\n');
		}
		return this.assistantText;
	}

	getTextOutput(): string {
		return this.assistantText;
	}

	setFinalResult(result?: string): void {
		if (this.streamItems.length === 0 && result?.trim()) {
			this.assistantText = result;
		} else if (result?.trim()) {
			this.assistantText = result;
		}
	}

	private recordStructured(jsonContent: string): void {
		this.streamItems.push(jsonContent);
	}

	async begin(): Promise<void> {
		await this.sink.onBegin();
	}

	async end(): Promise<void> {
		await this.sink.onEnd();
	}

	async consumeDelta(update: InteractionUpdate): Promise<void> {
		const jsonContent = encodeCursorSdkChunk({
			channel: 'delta',
			data: update as unknown as Record<string, unknown>,
		});
		this.recordStructured(jsonContent);
		await this.sink.onStructured(jsonContent);

		if (update.type === 'text-delta' && update.text) {
			this.assistantText += update.text;
		}
	}
}

/** @deprecated 使用 CursorStreamAssembler */
export class CursorStreamAdapter extends CursorStreamAssembler {}
