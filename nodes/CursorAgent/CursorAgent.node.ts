import {
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type ILoadOptionsFunctions,
	type INodeExecutionData,
	type INodePropertyOptions,
	type INodeType,
	type INodeTypeDescription,
} from 'n8n-workflow';
import type { InteractionUpdate, SDKAgent, SettingSource } from '@cursor/sdk';

import { parseMcpServers, type McpServersFormValue } from './lib/parseMcpServers';
import { ensureCursorPlatform } from './lib/ensureCursorPlatform';
import { loadCursorSdk } from './lib/loadCursorSdk';
import { resolveCursorApiKey } from './lib/resolveApiKey';
import { resolveLocalCwd } from './lib/resolveLocalCwd';
import { CursorStreamAssembler } from './lib/streamAdapter';
import { formatAskQuestionReply } from './lib/formatAskQuestionReply';
import {
	clearHitlPending,
	getHitlPending,
	setHitlPending,
} from './lib/hitlSessionStore';
import {
	parseAgentReply,
	type AgentRunMode,
	type AgentStatus,
} from './lib/hitlTypes';
import { applyHitlSystemMessage, readHitlEnabled } from './lib/hitlConfig';
import { getStoredAgentId, setStoredAgentId, type RedisCredentials } from './lib/sessionStore';
import type { Run } from '@cursor/sdk';

const DEFAULT_MODEL = 'composer-2.5';
const STATIC_MODEL_IDS = ['composer-2.5', 'composer-2', 'composer-1'] as const;

const SETTING_SOURCE_OPTIONS: INodePropertyOptions[] = [
	{ name: 'Project', value: 'project', description: 'Load .cursor from the working directory' },
	{ name: 'User', value: 'user' },
	{ name: 'Team', value: 'team' },
	{ name: 'MDM', value: 'mdm' },
	{ name: 'Plugins', value: 'plugins' },
	{ name: 'All', value: 'all' },
];

async function getModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	try {
		const { Cursor } = await loadCursorSdk();
		const apiKey = await resolveCursorApiKey(this);
		const models = await Cursor.models.list({ apiKey });
		const options = models
			.filter((m) => m?.id)
			.map((m) => ({
				name: m.displayName ? `${m.displayName} (${m.id})` : m.id,
				value: m.id,
				description: m.description,
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
		if (options.length > 0) return options;
		throw new Error('Cursor.models.list() returned an empty model list');
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return STATIC_MODEL_IDS.map((id) => ({
			name: id,
			value: id,
			description: `Fallback list: Cursor.models.list() failed (${message}). Check Cursor API credential and outbound access to api.cursor.com (proxy if needed).`,
		}));
	}
}

function readRedisCredentials(raw: IDataObject): RedisCredentials {
	return {
		host: String(raw.host ?? 'localhost'),
		port: Number(raw.port ?? 6379),
		user: raw.user ? String(raw.user) : undefined,
		password: raw.password ? String(raw.password) : undefined,
		database: raw.database !== undefined ? Number(raw.database) : 0,
	};
}

function readRunMode(raw: string): AgentRunMode {
	return raw === 'continue_hitl' ? 'continue_hitl' : 'new_turn';
}

async function consumeRunStream(
	assembler: CursorStreamAssembler,
	run: Run,
): Promise<boolean> {
	if (!run.supports('stream')) return false;
	for await (const event of run.stream()) {
		if (
			event.type === 'request'
			|| event.type === 'status'
			|| event.type === 'task'
		) {
			await assembler.consumeMessage(event);
			if (
				event.type === 'request'
				&& assembler.isAwaitingInput()
				&& assembler.getPendingQuestionMeta()
			) {
				return true;
			}
		}
	}
	return false;
}

function readSettingSources(raw: string | string[] | undefined): SettingSource[] {
	if (!raw) return ['project'];
	const values = Array.isArray(raw) ? raw : [raw];
	return values.filter(Boolean) as SettingSource[];
}

export class CursorAgent implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Cursor Agent',
		name: 'cursorAgent',
		icon: 'file:cursor.svg',
		group: ['transform'],
		version: 2,
		subtitle: '={{$parameter["model"]}}',
		description: 'Run Cursor Agent via the Cursor SDK (local runtime) with configurable MCP servers and skills',
		defaults: {
			name: 'Cursor Agent',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'cursorApi',
				required: true,
			},
			{
				name: 'redis',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'System Message',
				name: 'systemMessage',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				description: 'System prompt prepended on the first turn (ignored when resuming an existing session)',
			},
			{
				displayName: 'User Message',
				name: 'chatInput',
				type: 'string',
				default: '',
				description: 'Current user message sent to the Cursor agent',
			},
			{
				displayName: 'Session ID',
				name: 'sessionId',
				type: 'string',
				default: '',
				description: 'Optional conversation key stored in Redis to resume the same Cursor agent across runs',
			},
			{
				displayName: 'Run Mode',
				name: 'runMode',
				type: 'options',
				options: [
					{ name: 'New Turn', value: 'new_turn' },
					{ name: 'Continue HITL', value: 'continue_hitl' },
				],
				default: 'new_turn',
				description: 'new_turn: user message; continue_hitl: submit AskQuestion answer after Wait resume',
			},
			{
				displayName: 'Agent Reply (JSON)',
				name: 'agentReply',
				type: 'json',
				default: {},
				displayOptions: {
					show: {
						runMode: ['continue_hitl'],
					},
				},
				description: 'Structured AskQuestion answer from HITL resume webhook',
			},
			{
				displayName: 'Resume URL',
				name: 'resumeUrl',
				type: 'string',
				default: '={{ $execution.resumeUrl }}',
				description: 'n8n Wait resume URL injected into hitl_checkpoint stream event',
			},
			{
				displayName: 'Execution ID',
				name: 'executionId',
				type: 'string',
				default: '={{ $execution.id }}',
				description: 'Current n8n execution id for HITL checkpoint',
			},
			{
				displayName: 'HITL Segment Index',
				name: 'segmentIndex',
				type: 'number',
				default: 0,
				description: 'Zero-based HITL loop counter within a single user turn',
			},
			{
				displayName: 'HITL Enabled',
				name: 'hitlEnabled',
				type: 'boolean',
				default: true,
				description:
					'When enabled, AskQuestion pauses the run for human input (n8n Wait + resumeUrl). When disabled, Agent never enters awaiting_input.',
			},
			{
				displayName: 'Skills Root Directory',
				name: 'skillsRoot',
				type: 'string',
				default: '',
				description:
					'Directory containing .cursor/skills/. When set, placed first in local.cwd so project skills load from this root',
			},
			{
				displayName: 'Working Directories',
				name: 'workingDirectories',
				type: 'string',
				typeOptions: { multipleValues: true },
				default: [],
				description:
					'One or more absolute workspace paths. Combined with Skills Root and legacy Working Directory into local.cwd',
			},
			{
				displayName: 'Working Directory (legacy)',
				name: 'workingDirectory',
				type: 'string',
				default: '',
				description:
					'Deprecated: use Working Directories instead. Kept for backward compatibility with workflows created before 2.1.0',
			},
			{
				displayName: 'Setting Sources',
				name: 'settingSources',
				type: 'multiOptions',
				options: SETTING_SOURCE_OPTIONS,
				default: ['project'],
				description: 'Ambient Cursor settings layers loaded from the local filesystem (local runtime only)',
			},
			{
				displayName: 'Model',
				name: 'model',
				type: 'options',
				default: DEFAULT_MODEL,
				description:
					'Cursor model id from Cursor.models.list(); requires Cursor API credential on this node',
				typeOptions: {
					loadOptionsMethod: 'getModels',
				},
			},
			{
				displayName: 'Additional Options',
				name: 'additionalOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
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
										displayOptions: {
											show: {
												transport: ['http', 'sse'],
											},
										},
										description: 'Remote MCP endpoint URL',
									},
									{
										displayName: 'Headers',
										name: 'headers',
										type: 'fixedCollection',
										typeOptions: { multipleValues: true },
										default: {},
										displayOptions: {
											show: {
												transport: ['http', 'sse'],
											},
										},
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
										displayOptions: {
											show: {
												transport: ['http', 'sse'],
											},
										},
										description: 'Optional JSON object override for headers, e.g. {"Authorization":"Bearer token"}',
									},
									{
										displayName: 'Command',
										name: 'command',
										type: 'string',
										default: '',
										displayOptions: {
											show: {
												transport: ['stdio'],
											},
										},
									},
									{
										displayName: 'Arguments',
										name: 'args',
										type: 'string',
										typeOptions: { multipleValues: true },
										default: [],
										displayOptions: {
											show: {
												transport: ['stdio'],
											},
										},
										description: 'Command-line arguments in order',
									},
									{
										displayName: 'Environment Variables',
										name: 'envVars',
										type: 'fixedCollection',
										typeOptions: { multipleValues: true },
										default: {},
										displayOptions: {
											show: {
												transport: ['stdio'],
											},
										},
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
										displayOptions: {
											show: {
												transport: ['stdio'],
											},
										},
										description: 'Optional JSON object override for environment variables',
									},
									{
										displayName: 'Working Directory',
										name: 'cwd',
										type: 'string',
										default: '',
										displayOptions: {
											show: {
												transport: ['stdio'],
											},
										},
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
						description:
							'Optional JSON object keyed by server name. When set, overrides the MCP Servers form above',
					},
					{
						displayName: 'Session TTL (Seconds)',
						name: 'sessionTtlSeconds',
						type: 'number',
						default: 604800,
						description: 'Redis TTL for sessionId to agentId mapping',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			getModels,
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		let Agent: Awaited<ReturnType<typeof loadCursorSdk>>['Agent'];
		let CursorAgentError: Awaited<ReturnType<typeof loadCursorSdk>>['CursorAgentError'];
		let sdk: Awaited<ReturnType<typeof loadCursorSdk>>;
		try {
			sdk = await loadCursorSdk();
			({ Agent, CursorAgentError } = sdk);
			await ensureCursorPlatform(sdk);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new NodeOperationError(this.getNode(), message);
		}

		let apiKey: string;
		try {
			apiKey = await resolveCursorApiKey(this);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new NodeOperationError(this.getNode(), message);
		}

		const redisCredentials = readRedisCredentials(await this.getCredentials('redis'));

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const systemMessageRaw = this.getNodeParameter('systemMessage', itemIndex, '') as string;
				const chatInput = this.getNodeParameter('chatInput', itemIndex, '') as string;
				const sessionId = this.getNodeParameter('sessionId', itemIndex, '') as string;
				const skillsRoot = this.getNodeParameter('skillsRoot', itemIndex, '') as string;
				const workingDirectories = this.getNodeParameter('workingDirectories', itemIndex, []) as string[];
				const workingDirectory = this.getNodeParameter('workingDirectory', itemIndex, '') as string;
				const settingSources = readSettingSources(
					this.getNodeParameter('settingSources', itemIndex, ['project']) as string | string[],
				);
				const model = (this.getNodeParameter('model', itemIndex, DEFAULT_MODEL) as string) || DEFAULT_MODEL;
				const additionalOptions = this.getNodeParameter('additionalOptions', itemIndex, {}) as IDataObject;
				const mcpServersForm = (additionalOptions.mcpServers ?? {}) as McpServersFormValue;
				const mcpServersJson = String(additionalOptions.mcpServersJson ?? '');
				const sessionTtlSeconds = Number(additionalOptions.sessionTtlSeconds ?? 604800);

				const runMode = readRunMode(this.getNodeParameter('runMode', itemIndex, 'new_turn') as string);
				const agentReplyRaw = this.getNodeParameter('agentReply', itemIndex, {}) as unknown;
				const resumeUrl = String(this.getNodeParameter('resumeUrl', itemIndex, '') ?? '').trim();
				const executionId = String(this.getNodeParameter('executionId', itemIndex, '') ?? '').trim();
				const segmentIndex = Number(this.getNodeParameter('segmentIndex', itemIndex, 0) ?? 0);
				const hitlEnabled = readHitlEnabled(
					this.getNodeParameter('hitlEnabled', itemIndex, true) as boolean | string,
				);
				const systemMessage = applyHitlSystemMessage(systemMessageRaw, hitlEnabled);

				const agentReply = runMode === 'continue_hitl' ? parseAgentReply(agentReplyRaw) : null;
				if (runMode === 'continue_hitl') {
					if (!hitlEnabled) {
						throw new NodeOperationError(this.getNode(), 'HITL is disabled on this node (hitlEnabled=false)', {
							itemIndex,
						});
					}
					if (!agentReply) {
						throw new NodeOperationError(this.getNode(), 'agentReply is required for continue_hitl', {
							itemIndex,
						});
					}
					if (!sessionId) {
						throw new NodeOperationError(this.getNode(), 'sessionId is required for continue_hitl', {
							itemIndex,
						});
					}
				} else if (!chatInput?.trim()) {
					throw new NodeOperationError(this.getNode(), 'User message (chatInput) is empty', { itemIndex });
				}
				let cwd: string | string[];
				try {
					cwd = resolveLocalCwd({
						skillsRoot,
						workingDirectories,
						legacyWorkingDirectory: workingDirectory,
					});
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					throw new NodeOperationError(this.getNode(), message, { itemIndex });
				}

				let mcpServers;
				try {
					mcpServers = parseMcpServers(mcpServersJson, mcpServersForm);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					throw new NodeOperationError(this.getNode(), message, { itemIndex });
				}

				const localOptions = {
					cwd,
					settingSources,
				};
				const agentOptions = {
					apiKey,
					model: { id: model },
					local: localOptions,
					...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
				};

				const storedAgentId = sessionId
					? await getStoredAgentId(redisCredentials, sessionId)
					: undefined;

				if (runMode === 'continue_hitl') {
					const pending = await getHitlPending(redisCredentials, sessionId);
					if (!pending) {
						throw new NodeOperationError(this.getNode(), 'No pending HITL state for session', {
							itemIndex,
						});
					}
					if (
						pending.requestId !== agentReply!.requestId
						|| pending.callId !== agentReply!.callId
					) {
						throw new NodeOperationError(this.getNode(), 'agentReply does not match pending HITL state', {
							itemIndex,
						});
					}
				}

				let agent: SDKAgent;
				const resumeAgentId = runMode === 'continue_hitl'
					? (await getHitlPending(redisCredentials, sessionId))?.agentId
					: storedAgentId;
				if (resumeAgentId) {
					agent = await Agent.resume(resumeAgentId, agentOptions);
				} else {
					agent = await Agent.create(agentOptions);
				}

				try {
					let userPrompt: string;
					if (runMode === 'continue_hitl') {
						const pending = await getHitlPending(redisCredentials, sessionId);
						userPrompt = formatAskQuestionReply(agentReply!, pending?.pendingQuestion);
						await clearHitlPending(redisCredentials, sessionId);
					} else {
						userPrompt = storedAgentId
							? chatInput.trim()
							: [systemMessage?.trim(), chatInput.trim()].filter(Boolean).join('\n\n---\n\n');
					}

					const assembler = new CursorStreamAssembler({
						onBegin: async () => {
							if (this.isStreaming()) {
								await this.sendChunk('begin', itemIndex);
							}
						},
						onText: async () => {
							// 正文经 __cursor__ text 事件输出，避免与结构化流双轨
						},
						onStructured: async (jsonContent: string) => {
							if (this.isStreaming()) {
								await this.sendChunk('item', itemIndex, jsonContent);
							}
						},
						onEnd: async () => {
							if (this.isStreaming()) {
								await this.sendChunk('end', itemIndex);
							}
						},
					});

					await assembler.begin();

					const sendOptions = {
						...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
						onDelta: async ({ update }: { update: InteractionUpdate }) => {
							await assembler.consumeDelta(update);
						},
					};

					const run = await agent.send(userPrompt, sendOptions);
					const hitlPaused = await consumeRunStream(assembler, run);

					let agentStatus: AgentStatus = 'finished';
					let pendingQuestion = undefined as ReturnType<CursorStreamAssembler['getPendingQuestionMeta']>;

					if (hitlPaused && hitlEnabled) {
						agentStatus = 'awaiting_input';
						pendingQuestion = assembler.getPendingQuestionMeta();
						if (sessionId && pendingQuestion && executionId) {
							await setHitlPending(redisCredentials, sessionId, {
								provider: 'cursor',
								agentId: agent.agentId,
								runId: run.id,
								requestId: pendingQuestion.requestId,
								callId: pendingQuestion.callId,
								pendingQuestion,
								executionId,
								segmentIndex,
								createdAt: Date.now(),
							});
						}
						if (resumeUrl && executionId && pendingQuestion) {
							await assembler.emitHitlCheckpoint({
								executionId,
								resumeUrl,
								segmentIndex,
							});
						}
						if (run.supports('cancel')) {
							await run.cancel().catch(() => undefined);
						}
						await assembler.end();
					} else {
						const result = run.supports('wait') ? await run.wait() : { status: 'error' as const };
						assembler.setFinalResult(result.status === 'finished' ? result.result : undefined);
						await assembler.end();

						if (result.status === 'error') {
							agentStatus = 'error';
							const detail = ('result' in result ? result.result?.trim() : undefined)
								|| assembler.getTextOutput()?.trim()
								|| 'no error detail from SDK (check n8n logs for ConnectError / proxy issues)';
							throw new NodeOperationError(
								this.getNode(),
								`Cursor agent run failed: ${detail}`,
								{ itemIndex },
							);
						}
					}

					if (sessionId && agent.agentId) {
						await setStoredAgentId(redisCredentials, sessionId, agent.agentId, sessionTtlSeconds);
					}

					const output =
						assembler.getOutput({
							pendingQuestion: agentStatus === 'awaiting_input' ? pendingQuestion ?? null : null,
						})
						|| assembler.getTextOutput()
						|| '';

					returnData.push({
						json: {
							output,
							textOutput: assembler.getTextOutput() || '',
							model,
							agentId: agent.agentId,
							runId: run.id,
							sessionId,
							agentStatus,
							pendingQuestion: agentStatus === 'awaiting_input' ? pendingQuestion : undefined,
							segmentIndex,
							resumeUrl: agentStatus === 'awaiting_input' ? resumeUrl : undefined,
							executionId: agentStatus === 'awaiting_input' ? executionId : undefined,
						},
						pairedItem: { item: itemIndex },
					});
				} finally {
					await agent[Symbol.asyncDispose]();
				}
			} catch (error) {
				if (error instanceof CursorAgentError) {
					throw new NodeOperationError(this.getNode(), error.message, { itemIndex });
				}
				if (error instanceof NodeOperationError) throw error;
				const message = error instanceof Error ? error.message : String(error);
				throw new NodeOperationError(this.getNode(), message, { itemIndex });
			}
		}

		return [returnData];
	}
}
