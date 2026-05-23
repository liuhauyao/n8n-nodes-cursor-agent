/**
 * Local Cursor SDK smoke test (generic MCP + prompt).
 *
 * Required env:
 *   CURSOR_API_KEY
 *   POC_CWD              (working directory for local agent)
 *
 * Optional:
 *   POC_QUERY            (user message)
 *   POC_SYSTEM_MESSAGE   (prepended on first turn)
 *   POC_MCP_SERVERS_JSON (JSON object keyed by server name)
 *
 * Example:
 *   CURSOR_API_KEY=... POC_CWD=/path/to/project \
 *   POC_MCP_SERVERS_JSON='{"demo":{"type":"http","url":"https://example.com/mcp"}}' \
 *   npm run poc
 */
import { Agent } from '@cursor/sdk';

const apiKey = process.env.CURSOR_API_KEY;
const cwd = process.env.POC_CWD?.trim();
const query = process.env.POC_QUERY ?? 'Summarize what skills are available in this workspace.';
const systemMessage = process.env.POC_SYSTEM_MESSAGE?.trim() ?? '';
const mcpServersJson = process.env.POC_MCP_SERVERS_JSON?.trim() ?? '';

if (!apiKey || !cwd) {
	console.error('Missing CURSOR_API_KEY or POC_CWD');
	process.exit(1);
}

let mcpServers;
if (mcpServersJson) {
	try {
		mcpServers = JSON.parse(mcpServersJson);
	} catch {
		console.error('POC_MCP_SERVERS_JSON must be valid JSON');
		process.exit(1);
	}
}

const agent = await Agent.create({
	apiKey,
	model: { id: 'composer-2.5' },
	local: {
		cwd,
		settingSources: ['project'],
	},
	...(mcpServers ? { mcpServers } : {}),
});

try {
	const prompt = [systemMessage, query].filter(Boolean).join('\n\n---\n\n');

	const run = await agent.send(prompt, {
		...(mcpServers ? { mcpServers } : {}),
	});

	for await (const event of run.stream()) {
		if (event.type === 'assistant') {
			for (const block of event.message.content) {
				if (block.type === 'text') process.stdout.write(block.text);
			}
		} else if (event.type === 'tool_call' && event.status === 'running') {
			process.stdout.write(`\n[tool] ${event.name}\n`);
		}
	}

	const result = await run.wait();
	process.stdout.write('\n\n--- run result ---\n');
	process.stdout.write(JSON.stringify({ status: result.status, result: result.result?.slice?.(0, 500) }, null, 2));
	process.stdout.write('\n');
	if (result.status === 'error') process.exit(2);
} finally {
	await agent[Symbol.asyncDispose]();
}
