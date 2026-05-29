import {
	NodeConnectionTypes,
	NodeOperationError,
	type IExecuteFunctions,
	type ILoadOptionsFunctions,
	type INodeExecutionData,
	type INodePropertyOptions,
	type INodeType,
	type INodeTypeDescription,
} from 'n8n-workflow';
import type { InteractionUpdate, LocalAgentOptions, SDKAgent } from '@cursor/sdk';

import { CURSOR_AGENT_OPTIONS_PROPERTY } from './lib/agentOptionsProperties';
import { parseMcpServers } from './lib/parseMcpServers';
import { ensureCursorPlatform } from './lib/ensureCursorPlatform';
import { loadCursorSdk } from './lib/loadCursorSdk';
import { resolveCursorApiKey } from './lib/resolveApiKey';
import { resolveLocalCwd } from './lib/resolveLocalCwd';
import {
	readCursorAgentRunParams,
	resolveRedisForSession,
	tryGetRedisCredentials,
} from './lib/readNodeParameters';
import {
	appendPresetSystemMessage,
	getPresetLocalOptions,
	resolveCursorPermissionPreset,
} from './lib/permissionPresets';
import { CursorStreamAssembler } from './lib/streamAdapter';
import { getStoredAgentId, setStoredAgentId } from './lib/sessionStore';

const DEFAULT_MODEL = 'composer-2.5';
const STATIC_MODEL_IDS = ['composer-2.5', 'composer-2', 'composer-1'] as const;

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

export class CursorAgent implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Cursor Agent',
		name: 'cursorAgent',
		icon: 'file:cursor.svg',
		group: ['transform'],
		version: 3,
		subtitle: '={{$parameter["model"]}}',
		description:
			'Run Cursor Agent via the Cursor SDK (local runtime). Only User Message and Model are required; add Options for session, workspace, or MCP.',
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
				required: false,
			},
		],
		properties: [
			{
				displayName: 'User Message',
				name: 'chatInput',
				type: 'string',
				default: '',
				required: true,
				description: 'Current user message sent to the Cursor agent',
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
				displayName: 'System Message',
				name: 'systemMessage',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				description: 'Optional system prompt prepended on the first turn (ignored when resuming a session)',
			},
			CURSOR_AGENT_OPTIONS_PROPERTY,
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

		const redisCredentials = await tryGetRedisCredentials(this);

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const params = readCursorAgentRunParams(this, itemIndex);
				const model = (this.getNodeParameter('model', itemIndex, DEFAULT_MODEL) as string) || DEFAULT_MODEL;

				if (!params.chatInput?.trim()) {
					throw new NodeOperationError(this.getNode(), 'User message (chatInput) is empty', { itemIndex });
				}

				let mcpServers;
				try {
					mcpServers = parseMcpServers(params.mcpServersJson, params.mcpServersForm);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					throw new NodeOperationError(this.getNode(), message, { itemIndex });
				}

				const permissionPreset = resolveCursorPermissionPreset(params.permissionPreset);
				const presetLocal = getPresetLocalOptions(permissionPreset, params.settingSources);

				if (permissionPreset === 'plan_only') {
					mcpServers = {};
				}

				const agentOptions: {
					apiKey: string;
					model: { id: string };
					local?: LocalAgentOptions;
					mcpServers?: ReturnType<typeof parseMcpServers>;
				} = {
					apiKey,
					model: { id: model },
				};

				if (params.hasWorkspaceConfig) {
					const cwd = resolveLocalCwd({
						skillsRoot: params.skillsRoot,
						workingDirectories: params.workingDirectories,
						legacyWorkingDirectory: params.workingDirectory,
					});
					agentOptions.local = {
						...(cwd ? { cwd } : { cwd: process.cwd() }),
						settingSources: presetLocal.settingSources ?? params.settingSources,
						...(presetLocal.enableSandbox ? { sandboxOptions: { enabled: true } } : {}),
					};
				} else if (presetLocal.enableSandbox) {
					agentOptions.local = {
						cwd: process.cwd(),
						settingSources: presetLocal.settingSources ?? ['project'],
						sandboxOptions: { enabled: true },
					};
				}

				if (Object.keys(mcpServers).length > 0) {
					agentOptions.mcpServers = mcpServers;
				}

				const redis = resolveRedisForSession(
					this.getNode(),
					params.sessionId,
					redisCredentials,
					itemIndex,
				);

				const storedAgentId = params.sessionId && redis
					? await getStoredAgentId(redis, params.sessionId)
					: undefined;

				let agent: SDKAgent;
				if (storedAgentId) {
					agent = await Agent.resume(storedAgentId, agentOptions);
				} else {
					agent = await Agent.create(agentOptions);
				}

				try {
					const baseSystem = params.systemMessage?.trim() ?? '';
					const systemWithPreset = storedAgentId
						? baseSystem
						: appendPresetSystemMessage(baseSystem, permissionPreset);
					const userPrompt = storedAgentId
						? params.chatInput.trim()
						: [systemWithPreset, params.chatInput.trim()].filter(Boolean).join('\n\n---\n\n');

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
					const result = run.supports('wait') ? await run.wait() : { status: 'error' as const };
					assembler.setFinalResult(result.status === 'finished' ? result.result : undefined);
					await assembler.end();

					if (result.status === 'error') {
						const detail = ('result' in result ? result.result?.trim() : undefined)
							|| assembler.getTextOutput()?.trim()
							|| 'no error detail from SDK (check n8n logs for ConnectError / proxy issues)';
						throw new NodeOperationError(
							this.getNode(),
							`Cursor agent run failed: ${detail}`,
							{ itemIndex },
						);
					}

					if (params.sessionId && agent.agentId && redis) {
						await setStoredAgentId(redis, params.sessionId, agent.agentId, params.sessionTtlSeconds);
					}

					const output = assembler.getOutput() || assembler.getTextOutput() || '';

					returnData.push({
						json: {
							output,
							textOutput: assembler.getTextOutput() || '',
							model,
							agentId: agent.agentId,
							runId: run.id,
							sessionId: params.sessionId || undefined,
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
