import { NodeOperationError, type IDataObject, type IExecuteFunctions, type INode } from 'n8n-workflow';
import type { SettingSource } from '@cursor/sdk';

import type { McpToolAccessConfig } from './mcpToolAccess';
import type { McpServersFormValue } from './parseMcpServers';
import { readRedisCredentials, type RedisCredentials } from './sessionStore';

const DEFAULT_SETTING_SOURCES: SettingSource[] = ['project'];

export interface CursorAgentRunParams {
	systemMessage: string;
	chatInput: string;
	sessionId: string;
	sessionTtlSeconds: number;
	skillsRoot: string;
	workingDirectories: string[];
	workingDirectory: string;
		settingSources: SettingSource[];
	permissionPreset: string;
	maxTurns: number;
	mcpServersForm: McpServersFormValue;
	mcpServersJson: string;
	mcpToolAccess: McpToolAccessConfig;
	hasWorkspaceConfig: boolean;
}

function readSettingSources(raw: string | string[] | undefined): SettingSource[] {
	if (!raw || (Array.isArray(raw) && raw.length === 0)) return DEFAULT_SETTING_SOURCES;
	const values = Array.isArray(raw) ? raw : [raw];
	const filtered = values.filter(Boolean) as SettingSource[];
	return filtered.length > 0 ? filtered : DEFAULT_SETTING_SOURCES;
}

function pickString(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function pickStringArray(value: unknown): string[] {
	if (Array.isArray(value)) return value.map((item) => String(item ?? '')).filter(Boolean);
	if (typeof value === 'string' && value.trim()) return [value.trim()];
	return [];
}

/** 读取 v3 Options 集合并兼容 v2 扁平字段 */
export function readCursorAgentRunParams(
	ctx: IExecuteFunctions,
	itemIndex: number,
): CursorAgentRunParams {
	const options = ctx.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const session = (options.session ?? {}) as IDataObject;
	const workspace = (options.workspace ?? {}) as IDataObject;
	const agentBehavior = (options.agentBehavior ?? {}) as IDataObject;
	const mcp = (options.mcp ?? {}) as IDataObject;

	const legacyAdditional = ctx.getNodeParameter('additionalOptions', itemIndex, {}) as IDataObject;
	const legacyMcpForm = (legacyAdditional.mcpServers ?? {}) as McpServersFormValue;

	const skillsRoot =
		pickString(workspace.skillsRoot)
		|| pickString(ctx.getNodeParameter('skillsRoot', itemIndex, ''));
	const workingDirectories =
		pickStringArray(workspace.workingDirectories).length > 0
			? pickStringArray(workspace.workingDirectories)
			: pickStringArray(ctx.getNodeParameter('workingDirectories', itemIndex, []));
	const workingDirectory =
		pickString(workspace.workingDirectory)
		|| pickString(ctx.getNodeParameter('workingDirectory', itemIndex, ''));

	const settingSourcesRaw =
		workspace.settingSources !== undefined
			? workspace.settingSources
			: ctx.getNodeParameter('settingSources', itemIndex, DEFAULT_SETTING_SOURCES);

	const sessionId =
		pickString(session.sessionId)
		|| pickString(ctx.getNodeParameter('sessionId', itemIndex, ''));

	const sessionTtlSeconds = Number(
		session.sessionTtlSeconds
		?? legacyAdditional.sessionTtlSeconds
		?? 604800,
	);

	const permissionPreset =
		pickString(agentBehavior.permissionPreset)
		|| pickString(ctx.getNodeParameter('permissionPreset', itemIndex, 'full_agent'))
		|| 'full_agent';

	const maxTurnsRaw = Number(
		agentBehavior.maxTurns
		?? ctx.getNodeParameter('maxTurns', itemIndex, 0)
		?? 0,
	);

	const mcpServersForm = (mcp.mcpServers ?? legacyMcpForm ?? {}) as McpServersFormValue;
	const mcpServersJson = pickString(mcp.mcpServersJson)
		|| pickString(legacyAdditional.mcpServersJson);

	const mcpToolAccessRaw = (mcp.mcpToolAccess ?? {}) as IDataObject;
	const mcpToolAccess: McpToolAccessConfig = {
		filterMode: (pickString(mcpToolAccessRaw.filterMode) || 'none') as McpToolAccessConfig['filterMode'],
		deniedToolsRaw: pickString(mcpToolAccessRaw.deniedTools),
		allowedToolsRaw: pickString(mcpToolAccessRaw.allowedTools),
		allowComplementCatalogRaw: pickString(mcpToolAccessRaw.allowComplementCatalog),
	};

	const hasWorkspaceConfig = Boolean(
		skillsRoot.trim()
		|| workingDirectories.length > 0
		|| workingDirectory.trim()
		|| (Array.isArray(settingSourcesRaw) && settingSourcesRaw.length > 0)
		|| (typeof settingSourcesRaw === 'string' && settingSourcesRaw.trim()),
	);

	return {
		systemMessage: pickString(ctx.getNodeParameter('systemMessage', itemIndex, '')),
		chatInput: pickString(ctx.getNodeParameter('chatInput', itemIndex, '')),
		sessionId: sessionId.trim(),
		sessionTtlSeconds,
		skillsRoot: skillsRoot.trim(),
		workingDirectories,
		workingDirectory: workingDirectory.trim(),
		settingSources: readSettingSources(settingSourcesRaw as string | string[] | undefined),
		permissionPreset,
		maxTurns: maxTurnsRaw,
		mcpServersForm,
		mcpServersJson,
		mcpToolAccess,
		hasWorkspaceConfig,
	};
}

export async function tryGetRedisCredentials(
	ctx: IExecuteFunctions,
): Promise<RedisCredentials | undefined> {
	try {
		return readRedisCredentials(await ctx.getCredentials('redis'));
	} catch {
		return undefined;
	}
}

export function resolveRedisForSession(
	node: INode,
	sessionId: string,
	redis: RedisCredentials | undefined,
	itemIndex: number,
): RedisCredentials | undefined {
	if (!sessionId) return undefined;
	if (!redis) {
		throw new NodeOperationError(
			node,
			'Session ID is set but no Redis credential is configured on this node. '
				+ 'Add a Redis credential under Options → Session, or clear Session ID.',
			{ itemIndex },
		);
	}
	return redis;
}
