import { accessSync, constants } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { getCommunityNodesRootForDiagnostics } from './resolveHostModule';

const hostRequire = createRequire(__filename);

const PLATFORM_PACKAGES = [
	'@cursor/sdk-linux-x64',
	'@cursor/sdk-linux-arm64',
	'@cursor/sdk-darwin-x64',
	'@cursor/sdk-darwin-arm64',
	'@cursor/sdk-win32-x64',
] as const;

function getModuleSearchPaths(): string[] {
	const nodesRoot = getCommunityNodesRootForDiagnostics();
	return [nodesRoot, join(nodesRoot, 'node_modules')];
}

function isExecutable(path: string): boolean {
	try {
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/** Resolve bundled ripgrep from @cursor/sdk-* platform optional dependency. */
export function resolveRipgrepPath(): string | undefined {
	const paths = getModuleSearchPaths();
	for (const pkg of PLATFORM_PACKAGES) {
		for (const base of paths) {
			try {
				const pkgJson = hostRequire.resolve(`${pkg}/package.json`, { paths: [base] });
				const rgPath = join(dirname(pkgJson), 'bin', 'rg');
				if (isExecutable(rgPath)) return rgPath;
			} catch {
				// try next search root / platform package
			}
		}
	}
	return undefined;
}
