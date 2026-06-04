/**
 * 用户可见 Markdown 轻量规范化（与 matrees-ai preprocessMarkdown 对齐）。
 * 落库 textOutput / 流式 text_replace 前调用，降低 markstream 解析失败率。
 */

/** ATX 标题 # 后补空格 */
export function fixAtxHeadingMissingSpace(text: string): string {
	return text.replace(/^(#{1,6})([^\s#\n])/gm, '$1 $2');
}

/**
 * 修正 Agent 常见 Mermaid 围栏粘连：```mermaidflowchart → ```mermaid\nflowchart
 */
export function fixGluedMermaidFence(text: string): string {
	return text.replace(/```mermaid([^\n`])/g, '```mermaid\n$1');
}

/** 正文与 ```mermaid 粘在同一行时拆开 */
export function fixMermaidFenceDetached(text: string): string {
	return text.replace(/([^\n])(```mermaid)/g, '$1\n\n$2');
}

/** 多条无序列表挤在一行：…定胜负- **装甲 → 换行后再接 - ** */
export function fixGluedListItems(text: string): string {
	return text.replace(/([^\n\r])(-\s+\*\*)/g, '$1\n$2');
}

/** 标题行与表格首行粘在同一行：## 标题|列1|列2| → 拆成两行 */
export function fixHeadingTableGluedLine(line: string): string {
	const m = line.match(/^(#{1,6}\s+[^|\n]+)(\|.+)$/);
	if (!m) return line;
	return `${m[1].trim()}\n\n${m[2].trim()}`;
}

export function normalizeUserVisibleMarkdown(text: string): string {
	if (!text?.trim()) return '';
	let out = fixAtxHeadingMissingSpace(text);
	out = out
		.split(/\r?\n/)
		.map((line) => fixHeadingTableGluedLine(line))
		.join('\n');
	out = fixGluedMermaidFence(out);
	out = fixMermaidFenceDetached(out);
	out = fixGluedListItems(out);
	return out.trim();
}
