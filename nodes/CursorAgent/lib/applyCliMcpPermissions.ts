import fs from 'fs';
import path from 'path';

import {
	buildCursorMcpAllowTokens,
	buildCursorMcpDenyTokens,
	type McpToolAccessConfig,
	resolveAllowedMcpToolNames,
	resolveDeniedMcpToolNames,
} from './mcpToolAccess';

type CliPermissions = {
	allow?: string[];
	deny?: string[];
};

type CliConfig = {
	version: number;
	permissions: CliPermissions;
};

function readCliConfig(cliPath: string): CliConfig {
	if (!fs.existsSync(cliPath)) {
		return { version: 1, permissions: { allow: [], deny: [] } };
	}
	const raw = fs.readFileSync(cliPath, 'utf8');
	const parsed = JSON.parse(raw) as CliConfig;
	if (!parsed.permissions) {
		parsed.permissions = { allow: [], deny: [] };
	}
	if (!Array.isArray(parsed.permissions.allow)) parsed.permissions.allow = [];
	if (!Array.isArray(parsed.permissions.deny)) parsed.permissions.deny = [];
	return parsed;
}

function uniqueTokens(tokens: string[]): string[] {
	return [...new Set(tokens.filter(Boolean))];
}

function stripMcpWildcardAllow(allow: string[]): string[] {
	return allow.filter((t) => !/^Mcp\([^:]+:\*\)$/.test(t));
}

/**
 * 将 n8n 节点 MCP Tool Filter 合并进 Skills Root 下的 .cursor/cli.json。
 */
export function applyMcpToolFilterToCliJson(
	skillsRoot: string,
	serverNames: string[],
	access: McpToolAccessConfig,
): void {
	if (!skillsRoot.trim() || serverNames.length === 0 || access.filterMode === 'none') {
		return;
	}

	const allowed = resolveAllowedMcpToolNames(access);
	const denied = resolveDeniedMcpToolNames(access);
	if (allowed.length === 0 && denied.length === 0) return;

	const cursorDir = path.join(skillsRoot, '.cursor');
	const cliPath = path.join(cursorDir, 'cli.json');
	const config = readCliConfig(cliPath);

	const denySet = new Set([
		...(config.permissions.deny ?? []),
	]);

	let allowList = [...(config.permissions.allow ?? [])];

	if (access.filterMode === 'allow' && allowed.length > 0) {
		allowList = uniqueTokens([
			...stripMcpWildcardAllow(allowList),
			...buildCursorMcpAllowTokens(serverNames, allowed),
		]);
	} else if (denied.length > 0) {
		for (const token of buildCursorMcpDenyTokens(serverNames, denied)) {
			denySet.add(token);
		}
		for (const server of serverNames) {
			const wildcard = `Mcp(${server}:*)`;
			if (!allowList.includes(wildcard)) {
				allowList.push(wildcard);
			}
		}
	}

	config.permissions.allow = uniqueTokens(allowList);
	config.permissions.deny = uniqueTokens([...denySet]);
	config.version = config.version || 1;

	fs.mkdirSync(cursorDir, { recursive: true });
	fs.writeFileSync(cliPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}
