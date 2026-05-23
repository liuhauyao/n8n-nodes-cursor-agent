import { createClient } from 'redis';

type RedisClient = ReturnType<typeof createClient>;

const SESSION_KEY_PREFIX = 'cursor-agent:session:';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface RedisCredentials {
	host: string;
	port: number;
	user?: string;
	password?: string;
	database?: number;
}

export async function withRedisClient<T>(
	credentials: RedisCredentials,
	fn: (client: RedisClient) => Promise<T>,
): Promise<T> {
	const client = createClient({
		socket: {
			host: credentials.host,
			port: credentials.port,
		},
		username: credentials.user || undefined,
		password: credentials.password || undefined,
		database: credentials.database ?? 0,
	});
	await client.connect();
	try {
		return await fn(client);
	} finally {
		await client.quit();
	}
}

export async function getStoredAgentId(
	credentials: RedisCredentials,
	sessionId: string,
): Promise<string | undefined> {
	if (!sessionId) return undefined;
	return withRedisClient(credentials, async (client) => {
		const value = await client.get(`${SESSION_KEY_PREFIX}${sessionId}`);
		return value ?? undefined;
	});
}

export async function setStoredAgentId(
	credentials: RedisCredentials,
	sessionId: string,
	agentId: string,
	ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<void> {
	if (!sessionId || !agentId) return;
	await withRedisClient(credentials, async (client) => {
		await client.set(`${SESSION_KEY_PREFIX}${sessionId}`, agentId, { EX: ttlSeconds });
	});
}
