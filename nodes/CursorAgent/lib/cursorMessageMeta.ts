import type { AssistantTimelineBlock } from './assistantTimeline';

export interface CursorToolCallMeta {
	id: string;
	label: string;
	rawName: string;
	done: boolean;
}

export type { AssistantTimelineBlock };

export interface CursorMessageMeta {
	toolCalls?: CursorToolCallMeta[];
	thinkingDurationMs?: number;
	thinking?: string;
	suggestions?: string[];
	timeline?: AssistantTimelineBlock[];
}

const CURSOR_META_RE = /<cursor_meta>([\s\S]*?)<\/cursor_meta>/i;
const CURSOR_THINKING_TAG = '(?:redacted_thinking|think)';
const THINKING_BLOCK_RE = new RegExp(
	`<\\s*${CURSOR_THINKING_TAG}\\s*>([\\s\\S]*?)<\\s*\\/\\s*${CURSOR_THINKING_TAG}\\s*>`,
	'gi',
);

/** 合并 output 标签提取与 SDK thinkingBuffer，避免只落库第一块 */
export function mergeThinkingForMeta(extracted: string, buffered: string): string {
	const fromTags = extracted.trim();
	const fromBuffer = buffered.trim();
	if (!fromTags) return fromBuffer;
	if (!fromBuffer) return fromTags;
	if (fromTags.includes(fromBuffer)) return fromTags;
	if (fromBuffer.includes(fromTags)) return fromBuffer;
	return `${fromTags}\n\n${fromBuffer}`;
}

export function stripCursorMessageMeta(content: string): string {
	if (!content) return '';
	return content.replace(CURSOR_META_RE, '').trimEnd();
}

/** 从 output 中提取全部 thinking 块正文 */
export function extractThinkingFromOutput(output: string): string {
	if (!output) return '';
	const parts: string[] = [];
	const re = new RegExp(THINKING_BLOCK_RE.source, 'gi');
	let match: RegExpExecArray | null;
	while ((match = re.exec(output)) !== null) {
		const chunk = match[1].trim();
		if (chunk) parts.push(chunk);
	}
	return parts.join('\n\n');
}

export function embedCursorMessageMeta(content: string, meta: CursorMessageMeta): string {
	const clean = stripCursorMessageMeta(content);
	const hasTools = !!meta.toolCalls?.length;
	const hasDuration = meta.thinkingDurationMs !== undefined;
	const hasThinking = !!meta.thinking?.trim();
	const hasTimeline = !!meta.timeline?.length;
	const hasSuggestions = !!meta.suggestions?.length;
	if (!hasTools && !hasDuration && !hasThinking && !hasTimeline && !hasSuggestions) {
		return clean;
	}

	const payload: CursorMessageMeta = {};
	if (hasTools) {
		payload.toolCalls = meta.toolCalls!.map((t) => ({ ...t, done: true }));
	}
	if (hasDuration) {
		payload.thinkingDurationMs = meta.thinkingDurationMs;
	}
	if (hasThinking) {
		payload.thinking = meta.thinking!.trim();
	}
	if (hasSuggestions) {
		payload.suggestions = meta.suggestions;
	}
	if (hasTimeline) {
		payload.timeline = meta.timeline;
	}
	return `${clean}\n<cursor_meta>${JSON.stringify(payload)}</cursor_meta>`;
}
