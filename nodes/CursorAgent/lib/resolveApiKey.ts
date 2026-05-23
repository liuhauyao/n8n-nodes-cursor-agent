import type { IExecuteFunctions, ILoadOptionsFunctions } from 'n8n-workflow';

type CredentialContext = IExecuteFunctions | ILoadOptionsFunctions;

export async function resolveCursorApiKey(ctx: CredentialContext): Promise<string> {
	const cursorCredentials = await ctx.getCredentials('cursorApi');
	const fromCredential = String(cursorCredentials.apiKey ?? '').trim();
	if (fromCredential) return fromCredential;

	const fromEnv = String(process.env.CURSOR_API_KEY ?? '').trim();
	if (fromEnv) return fromEnv;

	throw new Error(
		'Cursor API key is required: create a Cursor API credential in n8n and select it on this node',
	);
}
