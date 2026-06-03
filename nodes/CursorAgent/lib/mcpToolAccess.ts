import type { McpServerConfig } from '@cursor/sdk';

export type McpToolFilterMode = 'none' | 'deny' | 'allow';

export interface McpToolAccessConfig {
	filterMode: McpToolFilterMode;
	deniedToolsRaw: string;
	allowedToolsRaw: string;
	allowComplementCatalogRaw: string;
}

export function parseToolNameList(raw: string): string[] {
	return raw
		.split(/[\n,]+/)
		.map((s) => s.trim())
		.filter(Boolean);
}

export function listMcpServerNames(
	mcpServers: Record<string, McpServerConfig>,
): string[] {
	return Object.keys(mcpServers).map((k) => k.trim()).filter(Boolean);
}

export function resolveDeniedMcpToolNames(config: McpToolAccessConfig): string[] {
	if (config.filterMode === 'none') return [];

	if (config.filterMode === 'deny') {
		return parseToolNameList(config.deniedToolsRaw);
	}

	const allowed = parseToolNameList(config.allowedToolsRaw);
	if (allowed.length === 0) return [];

	const catalog = parseToolNameList(config.allowComplementCatalogRaw);
	if (catalog.length === 0) return [];

	const allowedSet = new Set(allowed);
	return catalog.filter((name) => !allowedSet.has(name));
}

export function resolveAllowedMcpToolNames(config: McpToolAccessConfig): string[] {
	if (config.filterMode !== 'allow') return [];
	return parseToolNameList(config.allowedToolsRaw);
}

export function buildCursorMcpDenyTokens(
	serverNames: string[],
	toolNames: string[],
): string[] {
	const out: string[] = [];
	for (const server of serverNames) {
		for (const tool of toolNames) {
			out.push(`Mcp(${server}:${tool})`);
		}
	}
	return out;
}

export function buildCursorMcpAllowTokens(
	serverNames: string[],
	toolNames: string[],
): string[] {
	const out: string[] = [];
	for (const server of serverNames) {
		for (const tool of toolNames) {
			out.push(`Mcp(${server}:${tool})`);
		}
	}
	return out;
}
