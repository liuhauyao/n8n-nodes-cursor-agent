import type { AssistantTimelineBlock } from './assistantTimeline';

export interface CursorToolCallMeta {
	id: string;
	label: string;
	rawName: string;
	done: boolean;
}

export type { AssistantTimelineBlock };

export interface AgentMetaTodoItem {
	id: string;
	content: string;
	status: string;
}

export interface AgentMetaPendingQuestion {
	callId: string;
	title?: string;
	requestId: string;
	questions: Array<{
		id: string;
		prompt: string;
		options: Array<{ id: string; label: string }>;
		allowMultiple?: boolean;
	}>;
}

export interface CursorMessageMeta {
	toolCalls?: CursorToolCallMeta[];
	thinkingDurationMs?: number;
	thinking?: string;
	suggestions?: string[];
	todos?: AgentMetaTodoItem[];
	pendingQuestion?: AgentMetaPendingQuestion | null;
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

function collectTodosFromTimeline(timeline?: AssistantTimelineBlock[]): AgentMetaTodoItem[] | undefined {
	if (!timeline?.length) return undefined;
	const items: AgentMetaTodoItem[] = [];
	for (const block of timeline) {
		if (block.type === 'todos' && 'items' in block && Array.isArray(block.items)) {
			for (const item of block.items) {
				if (item?.id && item.content) {
					items.push({ id: item.id, content: item.content, status: item.status ?? 'pending' });
				}
			}
		}
	}
	return items.length > 0 ? items : undefined;
}

export function embedCursorMessageMeta(content: string, meta: CursorMessageMeta): string {
	const clean = stripCursorMessageMeta(content);
	const todos = meta.todos ?? collectTodosFromTimeline(meta.timeline);
	const hasTools = !!meta.toolCalls?.length;
	const hasDuration = meta.thinkingDurationMs !== undefined;
	const hasThinking = !!meta.thinking?.trim();
	const hasTimeline = !!meta.timeline?.length;
	const hasSuggestions = !!meta.suggestions?.length;
	const hasTodos = !!todos?.length;
	const hasPending = meta.pendingQuestion !== undefined && meta.pendingQuestion !== null;
	if (!hasTools && !hasDuration && !hasThinking && !hasTimeline && !hasSuggestions && !hasTodos && !hasPending) {
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
	if (hasTodos) {
		payload.todos = todos;
	}
	if (hasPending) {
		payload.pendingQuestion = meta.pendingQuestion;
	}
	if (hasTimeline) {
		payload.timeline = meta.timeline;
	}
	return `${clean}\n<cursor_meta>${JSON.stringify(payload)}</cursor_meta>`;
}
