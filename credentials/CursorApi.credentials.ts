import type { ICredentialTestRequest, ICredentialType, Icon, INodeProperties } from 'n8n-workflow';

export class CursorApi implements ICredentialType {
	name = 'cursorApi';

	displayName = 'Cursor API';

	icon: Icon = 'file:cursor.svg';

	documentationUrl = 'https://cursor.com/docs/sdk/typescript';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description: 'Cursor user or service account API key (CURSOR_API_KEY)',
		},
	];

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.cursor.com',
			url: '/v0/me',
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};
}
