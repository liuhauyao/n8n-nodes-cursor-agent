/**
 * Merge skills root, multi-value working directories, and legacy single cwd
 * into the shape expected by @cursor/sdk LocalAgentOptions.cwd.
 */
export function resolveLocalCwd(params: {
	skillsRoot?: string;
	workingDirectories?: string | string[];
	legacyWorkingDirectory?: string;
}): string | string[] {
	const ordered: string[] = [];

	const skillsRoot = params.skillsRoot?.trim();
	if (skillsRoot) ordered.push(skillsRoot);

	const rawDirs = params.workingDirectories;
	const dirList = Array.isArray(rawDirs)
		? rawDirs
		: rawDirs
			? [rawDirs]
			: [];

	for (const dir of dirList) {
		const trimmed = String(dir ?? '').trim();
		if (trimmed) ordered.push(trimmed);
	}

	const legacy = params.legacyWorkingDirectory?.trim();
	if (legacy) ordered.push(legacy);

	const unique = [...new Set(ordered)];
	if (unique.length === 0) {
		throw new Error('At least one working directory is required');
	}
	if (unique.length === 1) return unique[0];
	return unique;
}
