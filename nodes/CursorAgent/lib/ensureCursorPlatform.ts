import type { CursorSdkModule } from './loadCursorSdk';
import { loadCursorSdk } from './loadCursorSdk';
import { resolveRipgrepPath } from './resolveRipgrepPath';

let platformPromise: Promise<void> | undefined;

/**
 * Configure the Cursor SDK platform once per process (ripgrep for local agent).
 * Must run before Agent.create / Agent.resume.
 */
export async function ensureCursorPlatform(sdk?: CursorSdkModule): Promise<void> {
	if (!platformPromise) {
		platformPromise = initPlatform(sdk).catch((error: unknown) => {
			platformPromise = undefined;
			throw error;
		});
	}
	return platformPromise;
}

async function initPlatform(sdk?: CursorSdkModule): Promise<void> {
	const { createAgentPlatform } = sdk ?? await loadCursorSdk();
	const ripgrepPath = resolveRipgrepPath();
	if (!ripgrepPath) {
		throw new Error(
			'Cursor SDK platform binary (@cursor/sdk-linux-x64 etc.) not found in ~/.n8n/nodes. '
				+ 'Add matching optionalDependencies, run npm install, then restart n8n.',
		);
	}
	await createAgentPlatform({ ripgrepPath });
}
