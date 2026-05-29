import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';

import { MCP_SERVER_OPTION_PROPERTIES } from './mcpServerProperties';

const SETTING_SOURCE_OPTIONS: INodePropertyOptions[] = [
	{ name: 'Project', value: 'project', description: 'Load .cursor from the working directory' },
	{ name: 'User', value: 'user' },
	{ name: 'Team', value: 'team' },
	{ name: 'MDM', value: 'mdm' },
	{ name: 'Plugins', value: 'plugins' },
	{ name: 'All', value: 'all' },
];

/**
 * n8n 社区节点惯例：顶层仅必填/常用项；Skills / MCP / 工作目录 / 会话等通过 Options 按需添加。
 */
export const CURSOR_AGENT_OPTIONS_PROPERTY: INodeProperties = {
	displayName: 'Options',
	name: 'options',
	type: 'collection',
	placeholder: 'Add Option',
	default: {},
	options: [
		{
			displayName: 'Session',
			name: 'session',
			type: 'collection',
			placeholder: 'Configure Session',
			default: {},
			description: 'Multi-turn persistence via Redis (requires Redis credential on this node)',
			options: [
				{
					displayName: 'Session ID',
					name: 'sessionId',
					type: 'string',
					default: '',
					description: 'Business conversation key mapped to Cursor agentId in Redis',
				},
				{
					displayName: 'Session TTL (Seconds)',
					name: 'sessionTtlSeconds',
					type: 'number',
					default: 604800,
					description: 'Redis key TTL for the session mapping',
				},
			],
		},
		{
			displayName: 'Workspace',
			name: 'workspace',
			type: 'collection',
			placeholder: 'Configure Workspace',
			default: {},
			description: 'Skills root, working directories, and Cursor setting layers',
			options: [
				{
					displayName: 'Skills Root Directory',
					name: 'skillsRoot',
					type: 'string',
					default: '',
					description:
						'Directory containing .cursor/skills/. When set, placed first in local.cwd',
				},
				{
					displayName: 'Working Directories',
					name: 'workingDirectories',
					type: 'string',
					typeOptions: { multipleValues: true },
					default: [],
					description: 'One or more absolute workspace paths (merged with Skills Root)',
				},
				{
					displayName: 'Working Directory (Legacy)',
					name: 'workingDirectory',
					type: 'string',
					default: '',
					description: 'Deprecated single-path field; kept for older workflows',
				},
				{
					displayName: 'Setting Sources',
					name: 'settingSources',
					type: 'multiOptions',
					options: SETTING_SOURCE_OPTIONS,
					default: ['project'],
					description: 'Cursor settings layers loaded from the local filesystem',
				},
			],
		},
		{
			displayName: 'Agent Behavior',
			name: 'agentBehavior',
			type: 'collection',
			placeholder: 'Configure Behavior',
			default: {},
			options: [
				{
					displayName: 'Permission Preset',
					name: 'permissionPreset',
					type: 'options',
					default: 'full_agent',
					options: [
						{ name: 'MCP + Skills Only', value: 'mcp_skills_only' },
						{ name: 'Plan — No Tools', value: 'plan_only' },
						{ name: 'Restricted — Read/Web + MCP (Legacy)', value: 'customer_service' },
						{ name: 'Strict Read Only (Legacy)', value: 'read_only' },
						{ name: 'Full Cursor Agent Tools', value: 'full_agent' },
					],
					description:
						'mcp_skills_only / plan_only 依赖 Skills Root 下 .cursor/cli.json（Linux 服务器不启用 sandbox）；Claude Agent 侧为 SDK 硬限制',
				},
				{
					displayName: 'Max Turns',
					name: 'maxTurns',
					type: 'number',
					default: 12,
					description: 'Reserved for SDK parity (Cursor SDK 暂未接线)',
				},
			],
		},
		{
			displayName: 'MCP',
			name: 'mcp',
			type: 'collection',
			placeholder: 'Configure MCP',
			default: {},
			description: 'Optional MCP servers passed to the Cursor SDK',
			options: MCP_SERVER_OPTION_PROPERTIES,
		},
	],
};
