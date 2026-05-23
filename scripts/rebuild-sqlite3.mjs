/**
 * Ensure sqlite3 native bindings exist after community-node install.
 * n8n may install packages without running nested install scripts.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function canLoadSqlite3() {
	try {
		require('sqlite3');
		return true;
	} catch {
		return false;
	}
}

function resolveSqlite3Dir() {
	const candidates = [];
	try {
		candidates.push(dirname(require.resolve('sqlite3/package.json', { paths: [root] })));
	} catch {
		// ignore
	}
	try {
		const sdkRoot = dirname(require.resolve('@cursor/sdk/package.json', { paths: [root] }));
		candidates.push(join(sdkRoot, 'node_modules', 'sqlite3'));
	} catch {
		// ignore
	}
	return candidates.find((dir) => existsSync(join(dir, 'package.json')));
}

if (canLoadSqlite3()) {
	console.log('[n8n-nodes-cursor-agent] sqlite3 bindings OK');
	process.exit(0);
}

const sqlite3Dir = resolveSqlite3Dir();
if (!sqlite3Dir) {
	console.warn('[n8n-nodes-cursor-agent] sqlite3 package not found, skip rebuild');
	process.exit(0);
}

console.log(`[n8n-nodes-cursor-agent] Rebuilding sqlite3 in ${sqlite3Dir} ...`);
try {
	execFileSync('npm', ['rebuild', 'sqlite3', '--build-from-source'], {
		cwd: sqlite3Dir,
		stdio: 'inherit',
		env: process.env,
	});
} catch (error) {
	console.warn(
		'[n8n-nodes-cursor-agent] sqlite3 rebuild failed. '
			+ 'Install python3, make, and g++ on the host, then run: '
			+ `npm rebuild sqlite3 --build-from-source --prefix ${sqlite3Dir}`,
	);
	process.exit(0);
}

if (!canLoadSqlite3()) {
	console.warn('[n8n-nodes-cursor-agent] sqlite3 still unavailable after rebuild');
}
