import { redisGet, redisSetEx, type RedisCredentials } from './redisClient';

const SESSION_KEY_PREFIX = 'cursor-agent:session:';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7;

export type { RedisCredentials };

export async function getStoredAgentId(
	credentials: RedisCredentials,
	sessionId: string,
): Promise<string | undefined> {
	if (!sessionId) return undefined;
	const value = await redisGet(credentials, `${SESSION_KEY_PREFIX}${sessionId}`);
	return value ?? undefined;
}

export async function setStoredAgentId(
	credentials: RedisCredentials,
	sessionId: string,
	agentId: string,
	ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<void> {
	if (!sessionId || !agentId) return;
	await redisSetEx(credentials, `${SESSION_KEY_PREFIX}${sessionId}`, agentId, ttlSeconds);
}
