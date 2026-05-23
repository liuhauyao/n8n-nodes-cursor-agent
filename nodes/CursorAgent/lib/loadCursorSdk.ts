export type CursorSdkModule = typeof import('@cursor/sdk');

let sdkPromise: Promise<CursorSdkModule> | undefined;

export async function loadCursorSdk(): Promise<CursorSdkModule> {
	if (!sdkPromise) {
		sdkPromise = import('@cursor/sdk').catch((error: unknown) => {
			sdkPromise = undefined;
			throw formatCursorSdkLoadError(error);
		});
	}
	return sdkPromise;
}

function formatCursorSdkLoadError(error: unknown): Error {
	const message = error instanceof Error ? error.message : String(error);
	if (message.includes('node_sqlite3.node') || message.includes('bindings file')) {
		return new Error(
			'Failed to load @cursor/sdk: sqlite3 native bindings are missing. '
				+ 'On Linux, install build tools (python3, make, g++) and run '
				+ '`npm rebuild sqlite3 --build-from-source` inside the n8n-nodes-cursor-agent install directory, '
				+ 'or reinstall the community node after installing those packages.',
		);
	}
	return error instanceof Error ? error : new Error(message);
}
