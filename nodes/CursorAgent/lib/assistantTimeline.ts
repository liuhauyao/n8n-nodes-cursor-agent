import type { CursorToolCallMeta } from './cursorMessageMeta';
import {
	finalizeTimelineNextTags,
	isMeaningfulThinkingContent,
	sanitizeThinkingChunk,
	stripPostToolThinkingBlocks,
} from './cursorStreamProtocol';

export interface AssistantThinkingBlock {
	type: 'thinking';
	content: string;
	durationMs?: number;
	streaming?: boolean;
}

export interface AssistantToolsBlock {
	type: 'tools';
	calls: CursorToolCallMeta[];
}

export interface AssistantMarkdownBlock {
	type: 'markdown';
	content: string;
}

export interface AssistantTodosBlock {
	type: 'todos';
	items: Array<{ id: string; content: string; status: string }>;
	title?: string;
	status?: string;
}

export type AssistantTimelineBlock =
	| AssistantThinkingBlock
	| AssistantToolsBlock
	| AssistantMarkdownBlock
	| AssistantTodosBlock;

/** 按 SDK 事件顺序组装时间线 */
export class AssistantTimelineBuilder {
	blocks: AssistantTimelineBlock[] = [];
	suggestions: string[] = [];
	private finalized = false;
	private openThinking = -1;
	private openTools = -1;
	private openMarkdown = -1;

	onThinkingStart(): void {
		this.closeMarkdownSegment();
		if (this.openThinking >= 0) return;
		this.openThinking = this.blocks.length;
		this.blocks.push({ type: 'thinking', content: '', streaming: true });
	}

	onThinkingChunk(text: string): void {
		const chunk = sanitizeThinkingChunk(text);
		if (!chunk) return;
		if (this.openThinking < 0) this.onThinkingStart();
		const block = this.blocks[this.openThinking] as AssistantThinkingBlock;
		if (block.content.includes(chunk)) return;
		block.content += chunk;
	}

	onThinkingEnd(durationMs?: number): void {
		if (this.openThinking < 0) return;
		const block = this.blocks[this.openThinking] as AssistantThinkingBlock;
		block.streaming = false;
		if (durationMs !== undefined) block.durationMs = durationMs;
		block.content = sanitizeThinkingChunk(block.content);
		this.openThinking = -1;
	}

	onToolStart(tool: CursorToolCallMeta): void {
		this.onThinkingEnd();
		this.closeMarkdownSegment();
		if (this.openTools >= 0) {
			const block = this.blocks[this.openTools] as AssistantToolsBlock;
			block.calls.push({ ...tool });
			return;
		}
		this.openTools = this.blocks.length;
		this.blocks.push({ type: 'tools', calls: [{ ...tool }] });
	}

	onToolEnd(callId: string): void {
		if (this.openTools < 0) return;
		const block = this.blocks[this.openTools] as AssistantToolsBlock;
		const rec = block.calls.find((c) => c.id === callId);
		if (rec) rec.done = true;
		if (block.calls.every((c) => c.done)) {
			this.openTools = -1;
		}
	}

	onResponseText(text: string): void {
		if (!text) return;
		this.onThinkingEnd();
		if (this.openMarkdown >= 0) {
			const block = this.blocks[this.openMarkdown] as AssistantMarkdownBlock;
			block.content += text;
			return;
		}
		this.openMarkdown = this.blocks.length;
		this.blocks.push({ type: 'markdown', content: text });
	}

	onTodoUpdate(items: Array<{ id: string; content: string; status: string }>): void {
		if (!items.length) return;
		this.onThinkingEnd();
		this.closeMarkdownSegment();
		const idx = this.findLastTodosBlockIndex();
		if (idx >= 0) {
			const block = this.blocks[idx] as AssistantTodosBlock;
			block.items = items.map((item) => ({ ...item }));
			return;
		}
		this.blocks.push({
			type: 'todos',
			items: items.map((item) => ({ ...item })),
		});
	}

	private findLastTodosBlockIndex(): number {
		for (let i = this.blocks.length - 1; i >= 0; i--) {
			if (this.blocks[i].type === 'todos') return i;
		}
		return -1;
	}

	finalize(): void {
		if (this.finalized) return;
		this.finalized = true;
		this.onThinkingEnd();
		this.openTools = -1;
		this.closeMarkdownSegment();
		for (const block of this.blocks) {
			if (block.type === 'thinking') {
				block.streaming = false;
				block.content = sanitizeThinkingChunk(block.content);
			}
		}
		stripPostToolThinkingBlocks(this.blocks);
		this.blocks = this.pruneBlocks(this.blocks);
		this.suggestions = finalizeTimelineNextTags(this.blocks);
	}

	private pruneBlocks(blocks: AssistantTimelineBlock[]): AssistantTimelineBlock[] {
		const pruned: AssistantTimelineBlock[] = [];
		for (const block of blocks) {
			if (block.type === 'thinking') {
				if (!isMeaningfulThinkingContent(block.content)) continue;
				pruned.push({ ...block, streaming: false });
				continue;
			}
			if (block.type === 'markdown') {
				const content = block.content.trim();
				if (!content) continue;
				const last = pruned.at(-1);
				if (last?.type === 'markdown') {
					last.content = `${last.content.replace(/\n+$/, '')}\n\n${content}`;
				} else {
					pruned.push({ type: 'markdown', content });
				}
				continue;
			}
			if (block.type === 'tools' && block.calls.length > 0) {
				pruned.push({ type: 'tools', calls: block.calls.map((t) => ({ ...t })) });
			} else if (block.type === 'todos' && block.items.length > 0) {
				pruned.push({
					type: 'todos',
					items: block.items.map((item) => ({ ...item })),
					title: block.title,
					status: block.status,
				});
			}
		}
		return pruned;
	}

	private closeMarkdownSegment(): void {
		this.openMarkdown = -1;
	}
}

export function flattenToolCallsFromTimeline(blocks: AssistantTimelineBlock[]): CursorToolCallMeta[] {
	const out: CursorToolCallMeta[] = [];
	for (const block of blocks) {
		if (block.type === 'tools') out.push(...block.calls);
	}
	return out;
}

export function mergeThinkingFromTimeline(blocks: AssistantTimelineBlock[]): string {
	return blocks
		.filter((b): b is AssistantThinkingBlock => b.type === 'thinking')
		.map((b) => b.content.trim())
		.filter(Boolean)
		.join('\n\n');
}

/** 用户可见正文：仅最后一轮 markdown（跳过过程过渡句） */
export function lastMarkdownFromTimeline(blocks: AssistantTimelineBlock[]): string {
	const mdBlocks = blocks.filter((b): b is AssistantMarkdownBlock => b.type === 'markdown' && !!b.content?.trim());
	if (!mdBlocks.length) return '';
	return mdBlocks[mdBlocks.length - 1].content.trim();
}

/** @deprecated 仅内部调试；落库/展示请用 lastMarkdownFromTimeline */
export function mergeMarkdownFromTimeline(blocks: AssistantTimelineBlock[]): string {
	return blocks
		.filter((b): b is AssistantMarkdownBlock => b.type === 'markdown')
		.map((b) => b.content)
		.join('');
}
