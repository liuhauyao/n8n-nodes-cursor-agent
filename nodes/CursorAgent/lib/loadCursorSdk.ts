import { importHostModule } from './resolveHostModule';

export type CursorSdkModule = typeof import('@cursor/sdk');

let sdkPromise: Promise<CursorSdkModule> | undefined;

export async function loadCursorSdk(): Promise<CursorSdkModule> {
	if (!sdkPromise) {
		sdkPromise = importHostModule<CursorSdkModule>('@cursor/sdk').catch((error: unknown) => {
			sdkPromise = undefined;
			throw formatCursorSdkLoadError(error);
		});
	}
	return sdkPromise;
}

function formatCursorSdkLoadError(error: unknown): Error {
	const message = error instanceof Error ? error.message : String(error);
	if (message.includes('Cannot resolve "@cursor/sdk"')) {
		return new Error(
			'@cursor/sdk is not installed in ~/.n8n/nodes. '
				+ 'Add "@cursor/sdk": "1.0.13" to ~/.n8n/nodes/package.json, run npm install in that directory, then restart n8n.',
		);
	}
	if (message.includes('node_sqlite3.node') || message.includes('bindings file')) {
		return new Error(
			'@cursor/sdk platform binaries are missing. '
				+ 'In ~/.n8n/nodes/package.json add optionalDependencies matching your OS '
				+ '(e.g. "@cursor/sdk-linux-x64": "1.0.13"), run npm install in ~/.n8n/nodes, then restart n8n.',
		);
	}
	return error instanceof Error ? error : new Error(message);
}
