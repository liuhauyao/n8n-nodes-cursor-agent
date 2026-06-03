import type { INodeProperties } from 'n8n-workflow';

export const MCP_TOOL_FILTER_PROPERTIES: INodeProperties[] = [
	{
		displayName: 'MCP Tool Filter',
		name: 'mcpToolAccess',
		type: 'collection',
		placeholder: 'Configure Tool Filter',
		default: { filterMode: 'none' },
		description:
			'Limit MCP tools per configured server. Merged into Skills Root .cursor/cli.json (Cursor) or Claude SDK disallowedTools.',
		options: [
			{
				displayName: 'Filter Mode',
				name: 'filterMode',
				type: 'options',
				options: [
					{ name: 'No Filter', value: 'none' },
					{ name: 'Deny List', value: 'deny' },
					{ name: 'Allow List', value: 'allow' },
				],
				default: 'none',
			},
			{
				displayName: 'Denied Tool Names',
				name: 'deniedTools',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				description: 'Comma or newline separated bare tool names.',
				displayOptions: {
					show: {
						filterMode: ['deny'],
					},
				},
			},
			{
				displayName: 'Allowed Tool Names',
				name: 'allowedTools',
				type: 'string',
				typeOptions: { rows: 6 },
				default: '',
				displayOptions: {
					show: {
						filterMode: ['allow'],
					},
				},
			},
			{
				displayName: 'Tool Catalog (Allow Complement)',
				name: 'allowComplementCatalog',
				type: 'string',
				typeOptions: { rows: 8 },
				default: '',
				description:
					'Optional full tool list; with Allow List, non-listed catalog tools are denied.',
				displayOptions: {
					show: {
						filterMode: ['allow'],
					},
				},
			},
		],
	},
];
