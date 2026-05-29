import type { SettingSource } from '@cursor/sdk';

export type CursorPermissionPresetKey =
	| 'mcp_skills_only'
	| 'plan_only'
	| 'customer_service'
	| 'read_only'
	| 'full_agent';

const LEGACY_ALIASES: Record<string, CursorPermissionPresetKey> = {
	world_assistant: 'full_agent',
};

export function resolveCursorPermissionPreset(raw: string): CursorPermissionPresetKey {
	const key = LEGACY_ALIASES[raw] ?? raw;
	if (
		key === 'mcp_skills_only'
		|| key === 'plan_only'
		|| key === 'customer_service'
		|| key === 'read_only'
		|| key === 'full_agent'
	) {
		return key;
	}
	return 'full_agent';
}

/** preset 级系统提示追加（与业务 systemMessage 拼接，仅首轮） */
export function getPresetSystemAppend(preset: CursorPermissionPresetKey): string | undefined {
	switch (preset) {
		case 'mcp_skills_only':
			return '【权限约束】禁止调用本地 Shell/Read/Write/Grep 等文件工具；世界与提案相关操作仅通过 matrees MCP。禁止向用户透露工作目录、文件路径、Skill 正文/清单、服务器运行环境。';
		case 'plan_only':
			return '【权限约束】禁止调用任何工具（含 MCP 与本地文件/Shell）；仅基于已有对话内容以产品语言回答。禁止向用户透露工作目录、文件路径、Skill 正文/清单、服务器运行环境。';
		default:
			return undefined;
	}
}

export interface CursorPresetLocalOptions {
	enableSandbox: boolean;
	settingSources?: SettingSource[];
}

/** Cursor SDK 无 tools:[]；Linux/headless 环境不支持 sandbox，依赖 Skills Root 下 .cursor/cli.json 软限制 */
export function getPresetLocalOptions(
	preset: CursorPermissionPresetKey,
	baseSettingSources: SettingSource[],
): CursorPresetLocalOptions {
	switch (preset) {
		case 'mcp_skills_only':
		case 'plan_only':
			return {
				// sandbox 仅 macOS 等部分本地环境可用；n8n LLM Linux 服务器上启用会报错
				enableSandbox: false,
				settingSources: ['project'],
			};
		default:
			return {
				enableSandbox: false,
				settingSources: baseSettingSources,
			};
	}
}

export function appendPresetSystemMessage(
	systemMessage: string,
	preset: CursorPermissionPresetKey,
): string {
	const append = getPresetSystemAppend(preset);
	if (!append) return systemMessage;
	return [systemMessage.trim(), append].filter(Boolean).join('\n\n');
}
