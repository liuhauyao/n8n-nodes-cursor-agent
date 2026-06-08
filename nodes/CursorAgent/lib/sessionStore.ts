import { redisDel, redisGet, redisSetEx, type RedisCredentials } from './redisClient';
import type { IDataObject } from 'n8n-workflow';

const SESSION_KEY_PREFIX = 'cursor-agent:session:';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7;

export type { RedisCredentials };

export function readRedisCredentials(raw: IDataObject): RedisCredentials {
	return {
		host: String(raw.host ?? 'localhost'),
		port: Number(raw.port ?? 6379),
		user: raw.user ? String(raw.user) : undefined,
		password: raw.password ? String(raw.password) : undefined,
		database: raw.database !== undefined ? Number(raw.database) : 0,
	};
}

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

export async function clearStoredAgentId(
	credentials: RedisCredentials,
	sessionId: string,
): Promise<void> {
	if (!sessionId) return;
	await redisDel(credentials, `${SESSION_KEY_PREFIX}${sessionId}`);
}

/** n8n 重启后进程内 Agent 失效，Redis 仍可能存有旧 agentId。 */
export function isStaleAgentSessionError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /\bAgent\s+agent-[0-9a-f-]+\s+not found\b/i.test(message);
}
