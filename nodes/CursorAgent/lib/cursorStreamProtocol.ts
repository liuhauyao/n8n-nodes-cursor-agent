/** n8n item.content JSON envelope for Cursor-native stream events (not plain text). */
export const CURSOR_STREAM_MARKER = '__cursor__';

export interface CursorAskQuestionOption {
	id: string;
	label: string;
}

export interface CursorAskQuestionItem {
	id: string;
	prompt: string;
	options: CursorAskQuestionOption[];
	allowMultiple?: boolean;
}

export type CursorStreamPayload =
	| { kind: 'tool_start'; callId: string; name: string; label: string }
	| { kind: 'tool_end'; callId: string; ok?: boolean; error?: string }
	| { kind: 'thinking_start' }
	| { kind: 'thinking_chunk'; text: string }
	| { kind: 'thinking_end'; durationMs?: number }
	| { kind: 'text'; text: string }
	| { kind: 'status'; phase: string; message?: string }
	| {
			kind: 'ask_question';
			callId: string;
			title?: string;
			questions: CursorAskQuestionItem[];
	  }
	| { kind: 'awaiting_input'; requestId: string }
	| {
			kind: 'todo_update';
			items: Array<{ id: string; content: string; status: string }>;
	  }
	| {
			kind: 'hitl_checkpoint';
			executionId: string;
			resumeUrl: string;
			pendingQuestion: {
				callId: string;
				title?: string;
				requestId: string;
				questions: CursorAskQuestionItem[];
			};
			segmentIndex: number;
			requestId: string;
			callId: string;
	  };

export function encodeCursorStreamPayload(payload: CursorStreamPayload): string {
	return JSON.stringify({ [CURSOR_STREAM_MARKER]: payload });
}

export function tryParseCursorStreamPayload(content: string): CursorStreamPayload | null {
	const trimmed = content.trim();
	if (!trimmed.startsWith('{')) return null;
	try {
		const obj = JSON.parse(trimmed) as Record<string, unknown>;
		const payload = obj[CURSOR_STREAM_MARKER];
		if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
		const kind = (payload as Record<string, unknown>).kind;
		if (typeof kind !== 'string') return null;
		return payload as CursorStreamPayload;
	} catch {
		return null;
	}
}

/** SDK headless 回退文案：已由前端 AskQuestion 面板接管，不再展示给用户 */
const ASKQUESTION_UNAVAILABLE_PATTERNS: RegExp[] = [
	/^The AskQuestion tool is unavailable\.?$/i,
	/^AskQuestion tool is unavailable\.?$/i,
];

export function isAskQuestionUnavailableText(text: string): boolean {
	const t = text.trim();
	if (!t) return false;
	return ASKQUESTION_UNAVAILABLE_PATTERNS.some((re) => re.test(t));
}

export function shouldSuppressAssistantText(text: string): boolean {
	const t = text.trim();
	if (!t) return true;
	return isAskQuestionUnavailableText(t);
}

const NEXT_TAG_BLOCK_RE = /<next>([\s\S]*?)<\/next>/gi;
const NEXT_TAG_RE = /<\s*\/?\s*next\s*>/gi;

/** 移除 `<next>` 标签（中间段落不应携带建议项） */
export function stripNextTags(text: string): string {
	if (!text) return '';
	let result = text.replace(NEXT_TAG_BLOCK_RE, '');
	const openIdx = result.lastIndexOf('<next>');
	if (openIdx >= 0 && !result.slice(openIdx).includes('</next>')) {
		result = result.slice(0, openIdx);
	}
	return result.replace(NEXT_TAG_RE, '').trim();
}

/** 从正文提取 `<next>` 建议项（单块多行与多块均支持） */
export function extractNextSuggestions(text: string): string[] {
	if (!text) return [];
	const suggestions: string[] = [];
	const re = /<next>([\s\S]*?)<\/next>/gi;
	let match: RegExpExecArray | null;
	while ((match = re.exec(text)) !== null) {
		const block = match[1].trim();
		if (!block) continue;
		const lines = block
			.split(/\r?\n/)
			.map((line) => line.replace(/^[\s\-•*]+/, '').trim())
			.filter(Boolean);
		if (lines.length > 0) suggestions.push(...lines);
		else suggestions.push(block);
	}
	return suggestions;
}

/** 提取建议并从 timeline 所有 markdown 块移除 `<next>` */
export function finalizeTimelineNextTags(
	blocks: Array<{ type: string; content?: string }>,
): string[] {
	let lastMd = -1;
	for (let i = blocks.length - 1; i >= 0; i--) {
		if (blocks[i].type === 'markdown') {
			lastMd = i;
			break;
		}
	}
	const suggestions =
		lastMd >= 0 && blocks[lastMd].content
			? extractNextSuggestions(blocks[lastMd].content!)
			: [];
	for (const block of blocks) {
		if (block.type === 'markdown' && block.content) {
			block.content = stripNextTags(block.content);
		}
	}
	return suggestions;
}

export function sanitizeThinkingChunk(text: string): string {
	if (!text) return '';
	return text
		.replace(NEXT_TAG_BLOCK_RE, '')
		.replace(NEXT_TAG_RE, '')
		.replace(/<\/?to_summarize>/gi, '')
		.replace(/Part\s+\d+\s*\([^)]*\):[^\n]*/gi, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

export function isMeaningfulThinkingContent(content: string): boolean {
	const cleaned = sanitizeThinkingChunk(content);
	if (!cleaned) return false;
	if (cleaned.length < 8) return false;
	if (!/[\u4e00-\u9fa5a-zA-Z]/.test(cleaned)) return false;
	if (/[\u4e00-\u9fa5]/.test(cleaned)) return true;
	if (/^I will\b/i.test(cleaned)) return false;
	if (/^I need to\b/i.test(cleaned)) return false;
	if (/^Let me\b/i.test(cleaned)) return false;
	if (/foradditional details/i.test(cleaned)) return false;
	if (/mapinformation|thedefinition of/i.test(cleaned)) return false;
	return cleaned.length >= 40;
}

/** 移除第一个 tools 块之后出现的 thinking */
export function stripPostToolThinkingBlocks(
	blocks: Array<{ type: string; content?: string }>,
): void {
	let seenTools = false;
	for (let i = blocks.length - 1; i >= 0; i--) {
		const block = blocks[i];
		if (block.type === 'tools') {
			seenTools = true;
			continue;
		}
		if (block.type === 'thinking' && seenTools) {
			blocks.splice(i, 1);
		}
	}
}

export function isAskQuestionToolName(rawName: string): boolean {
	return rawName === 'AskQuestion' || rawName === 'askQuestion';
}

function normalizeQuestionOption(raw: unknown): CursorAskQuestionOption | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const record = raw as Record<string, unknown>;
	const id = typeof record.id === 'string' ? record.id : '';
	const label = typeof record.label === 'string' ? record.label : id;
	if (!id) return null;
	return { id, label };
}

function normalizeQuestionItem(raw: unknown): CursorAskQuestionItem | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const record = raw as Record<string, unknown>;
	const id = typeof record.id === 'string' ? record.id : '';
	const prompt =
		(typeof record.prompt === 'string' && record.prompt) ||
		(typeof record.question === 'string' && record.question) ||
		id;
	if (!id || !prompt) return null;

	const optionsRaw = record.options;
	if (!Array.isArray(optionsRaw)) return null;
	const options = optionsRaw
		.map(normalizeQuestionOption)
		.filter((item): item is CursorAskQuestionOption => item !== null);
	if (options.length === 0) return null;

	return {
		id,
		prompt,
		options,
		allowMultiple: record.allow_multiple === true || record.allowMultiple === true,
	};
}

/** 防御式解析 Cursor AskQuestion 工具参数（schema 不稳定，见 SDK 文档） */
export function parseAskQuestionArgs(args: unknown): {
	title?: string;
	questions: CursorAskQuestionItem[];
} | null {
	if (!args) return null;

	let record: Record<string, unknown>;
	if (typeof args === 'string') {
		try {
			record = JSON.parse(args) as Record<string, unknown>;
		} catch {
			return null;
		}
	} else if (typeof args === 'object' && !Array.isArray(args)) {
		record = args as Record<string, unknown>;
	} else {
		return null;
	}

	const nested = record.input ?? record.arguments ?? record.params;
	if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
		const nestedParsed = parseAskQuestionArgs(nested);
		if (nestedParsed) return nestedParsed;
	}

	const questionsRaw = record.questions;
	if (!Array.isArray(questionsRaw)) return null;

	const questions = questionsRaw
		.map(normalizeQuestionItem)
		.filter((item): item is CursorAskQuestionItem => item !== null);
	if (questions.length === 0) return null;

	const title = typeof record.title === 'string' ? record.title : undefined;
	return { title, questions };
}

export function parseUpdateTodosArgs(
	args: unknown,
): Array<{ id: string; content: string; status: string }> | null {
	if (!args) return null;

	let record: Record<string, unknown>;
	if (typeof args === 'string') {
		try {
			record = JSON.parse(args) as Record<string, unknown>;
		} catch {
			return null;
		}
	} else if (typeof args === 'object' && !Array.isArray(args)) {
		record = args as Record<string, unknown>;
	} else {
		return null;
	}

	const nested = record.input ?? record.arguments ?? record.params;
	if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
		const nestedParsed = parseUpdateTodosArgs(nested);
		if (nestedParsed) return nestedParsed;
	}

	const todosRaw = record.todos;
	if (!Array.isArray(todosRaw)) return null;

	const items = todosRaw
		.map((raw, index) => {
			if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
			const todo = raw as Record<string, unknown>;
			const content =
				(typeof todo.content === 'string' && todo.content)
				|| (typeof todo.title === 'string' && todo.title)
				|| '';
			if (!content.trim()) return null;
			const id =
				typeof todo.id === 'string' && todo.id.trim()
					? todo.id.trim()
					: `todo-${index}-${content.slice(0, 24)}`;
			const statusRaw = todo.status;
			const status =
				statusRaw === 'inProgress'
				|| statusRaw === 'completed'
				|| statusRaw === 'cancelled'
				|| statusRaw === 'pending'
					? statusRaw
					: 'pending';
			return { id, content: content.trim(), status };
		})
		.filter((item): item is { id: string; content: string; status: string } => item !== null);

	return items.length > 0 ? items : null;
}

/** 不在工具链 UI 展示的内部工具 */
const HIDDEN_TOOL_NAMES = new Set(['ReadLints', 'glob', 'Glob', 'Grep', 'Shell', 'Task'])

export function isUpdateTodosToolName(rawName?: string): boolean {
	if (!rawName) return false
	return rawName === 'updateTodos' || rawName === 'TodoWrite' || rawName === 'todoWrite'
}

export function shouldShowToolInUi(rawName: string): boolean {
	if (!rawName) return false
	if (isAskQuestionToolName(rawName)) return false
	if (isUpdateTodosToolName(rawName)) return false
	return !HIDDEN_TOOL_NAMES.has(rawName)
}

export function resolveMcpToolName(args: unknown): string {
	if (!args || typeof args !== 'object' || Array.isArray(args)) return 'mcp';
	const record = args as Record<string, unknown>;
	for (const key of ['toolName', 'name', 'tool', 'method']) {
		const value = record[key];
		if (typeof value === 'string' && value.trim()) return value.trim();
	}
	const nested = record.arguments ?? record.input ?? record.params;
	if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
		const inner = nested as Record<string, unknown>;
		for (const key of ['toolName', 'name', 'tool', 'method']) {
			const value = inner[key];
			if (typeof value === 'string' && value.trim()) return value.trim();
		}
	}
	return 'mcp';
}

/** 流式/落库：忠实保留 MCP 与 Cursor 原始工具名，不做本地化 */
export function resolveToolLabel(rawName: string): string {
	return rawName?.trim() || 'tool';
}

export function extractToolIdentity(toolCall: unknown): { name: string; args?: unknown } {
	if (!toolCall || typeof toolCall !== 'object' || Array.isArray(toolCall)) {
		return { name: 'tool' };
	}
	const record = toolCall as Record<string, unknown>;
	const typeName = typeof record.type === 'string' ? record.type : '';
	const explicitName = typeof record.name === 'string' ? record.name : '';
	const name = explicitName || typeName || 'tool';

	if (name === 'mcp' || name === 'MCP' || typeName === 'mcp') {
		const args = record.args ?? record.input ?? record.parameters;
		return { name: resolveMcpToolName(args), args };
	}

	const args = record.args ?? record.input;
	return { name, args };
}

export function stripCursorToolCallLines(text: string): string {
	if (!text) return '';
	let result = text;
	let match: RegExpExecArray | null;
	const re = /Calling\s+(\S+)\s+with\s+input:\s*\{/g;
	while ((match = re.exec(result)) !== null) {
		const start = match.index;
		const braceIndex = start + match[0].length - 1;
		let depth = 0;
		let inString = false;
		let escape = false;
		let end = -1;
		for (let i = braceIndex; i < result.length; i++) {
			const c = result[i];
			if (escape) {
				escape = false;
				continue;
			}
			if (c === '\\' && inString) {
				escape = true;
				continue;
			}
			if (c === '"') {
				inString = !inString;
				continue;
			}
			if (inString) continue;
			if (c === '{') depth++;
			else if (c === '}') {
				depth--;
				if (depth === 0) {
					end = i + 1;
					break;
				}
			}
		}
		if (end < 0) break;
		result = result.slice(0, start) + result.slice(end);
		re.lastIndex = start;
	}
	return result;
}
