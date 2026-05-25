import type { INodeProperties } from 'n8n-workflow';

/** MCP 表单 + JSON 覆盖（n8n Options → MCP 子项） */
export const MCP_SERVER_OPTION_PROPERTIES: INodeProperties[] = [
	{
		displayName: 'MCP Servers',
		name: 'mcpServers',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		default: {},
		description: 'Inline MCP servers passed to the Cursor SDK on create, resume, and send',
		options: [
			{
				displayName: 'Server',
				name: 'server',
				values: [
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						default: '',
						description: 'Key in the MCP servers map passed to the SDK',
					},
					{
						displayName: 'Transport',
						name: 'transport',
						type: 'options',
						options: [
							{ name: 'HTTP', value: 'http' },
							{ name: 'SSE', value: 'sse' },
							{ name: 'Stdio', value: 'stdio' },
						],
						default: 'http',
					},
					{
						displayName: 'URL',
						name: 'url',
						type: 'string',
						default: '',
						displayOptions: { show: { transport: ['http', 'sse'] } },
						description: 'Remote MCP endpoint URL',
					},
					{
						displayName: 'Headers',
						name: 'headers',
						type: 'fixedCollection',
						typeOptions: { multipleValues: true },
						default: {},
						displayOptions: { show: { transport: ['http', 'sse'] } },
						options: [
							{
								displayName: 'Header',
								name: 'header',
								values: [
									{ displayName: 'Name', name: 'name', type: 'string', default: '' },
									{ displayName: 'Value', name: 'value', type: 'string', default: '' },
								],
							},
						],
					},
					{
						displayName: 'Headers JSON',
						name: 'headersJson',
						type: 'string',
						default: '',
						displayOptions: { show: { transport: ['http', 'sse'] } },
						description: 'Optional JSON object override for headers',
					},
					{
						displayName: 'Command',
						name: 'command',
						type: 'string',
						default: '',
						displayOptions: { show: { transport: ['stdio'] } },
					},
					{
						displayName: 'Arguments',
						name: 'args',
						type: 'string',
						typeOptions: { multipleValues: true },
						default: [],
						displayOptions: { show: { transport: ['stdio'] } },
						description: 'Command-line arguments in order',
					},
					{
						displayName: 'Environment Variables',
						name: 'envVars',
						type: 'fixedCollection',
						typeOptions: { multipleValues: true },
						default: {},
						displayOptions: { show: { transport: ['stdio'] } },
						options: [
							{
								displayName: 'Variable',
								name: 'envVar',
								values: [
									{ displayName: 'Name', name: 'name', type: 'string', default: '' },
									{ displayName: 'Value', name: 'value', type: 'string', default: '' },
								],
							},
						],
					},
					{
						displayName: 'Environment JSON',
						name: 'envJson',
						type: 'string',
						default: '',
						displayOptions: { show: { transport: ['stdio'] } },
					},
					{
						displayName: 'Working Directory',
						name: 'cwd',
						type: 'string',
						default: '',
						displayOptions: { show: { transport: ['stdio'] } },
						description: 'Optional cwd for the stdio MCP server process',
					},
				],
			},
		],
	},
	{
		displayName: 'MCP Servers JSON',
		name: 'mcpServersJson',
		type: 'string',
		typeOptions: { rows: 6 },
		default: '',
		description: 'JSON object keyed by server name. When set, overrides the MCP Servers form above',
	},
];
