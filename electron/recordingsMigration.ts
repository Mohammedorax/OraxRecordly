import fs from "node:fs/promises";
import path from "node:path";

/**
 * One-time tidy-up for recordings made before footage moved into `Cache`.
 *
 * Old takes sit directly in the recordings folder, next to the exported videos
 * and the project files, while new ones are written into `Cache`. Moving them
 * would break every project that references them, so the move and the project
 * rewrite happen together, and only for files that are plainly recordings.
 */

/** Media the recorder itself produces. */
/**
 * The recorder's own naming.
 *
 * Only these files move: exported videos and imported media live in the same
 * folder, and moving them into the footage cache would be wrong.
 */
const RECORDING_NAME_PATTERN = /^recording[-_]/i;

/** Directories under the recordings root that are never touched. */
const RESERVED_DIRECTORIES = new Set(["Cache", "Projects", "Screenshots", ".recordly-media"]);

export type RecordingEntry = {
	name: string;
	isFile: boolean;
};

export type RecordingMove = {
	from: string;
	to: string;
};

export type LegacyMigrationPlan = {
	moves: RecordingMove[];
	/** Top-level entries that are deliberately left where they are. */
	kept: string[];
};

function isRecordingName(name: string): boolean {
	return RECORDING_NAME_PATTERN.test(name);
}

function uniqueTargetName(name: string, taken: ReadonlySet<string>): string {
	if (!taken.has(name.toLowerCase())) {
		return name;
	}

	const extension = path.extname(name);
	const stem = name.slice(0, name.length - extension.length);
	for (let index = 1; index < 1000; index += 1) {
		const candidate = `${stem} (${index})${extension}`;
		if (!taken.has(candidate.toLowerCase())) {
			return candidate;
		}
	}

	return `${stem}-${Date.now()}${extension}`;
}

/**
 * Works out which top-level recording files should move into `Cache`.
 *
 * Pure: the caller lists the directory and performs the moves, so the decision is
 * covered by tests without touching the file system.
 */
export function planLegacyRecordingMigration(options: {
	rootDir: string;
	entries: readonly RecordingEntry[];
	/** Names already present in `Cache`, lower-cased. */
	cacheNames?: ReadonlySet<string>;
}): LegacyMigrationPlan {
	const { rootDir, entries } = options;
	const taken = new Set<string>(
		[...(options.cacheNames ?? [])].map((name) => name.toLowerCase()),
	);
	const moves: RecordingMove[] = [];
	const kept: string[] = [];

	for (const entry of entries) {
		if (!entry.isFile) {
			kept.push(entry.name);
			continue;
		}
		if (RESERVED_DIRECTORIES.has(entry.name)) {
			kept.push(entry.name);
			continue;
		}
		if (!isRecordingName(entry.name)) {
			kept.push(entry.name);
			continue;
		}

		const targetName = uniqueTargetName(entry.name, taken);
		taken.add(targetName.toLowerCase());
		moves.push({
			from: path.join(rootDir, entry.name),
			to: path.join(rootDir, "Cache", targetName),
		});
	}

	return { moves, kept };
}

/** Paths inside a project file may be written as plain text or URL-encoded. */
export function buildPathReplacements(moves: readonly RecordingMove[]): Array<{
	from: string;
	to: string;
}> {
	return moves.flatMap((move) => {
		const variants: Array<{ from: string; to: string }> = [];
		const push = (from: string, to: string) => {
			if (from !== to && !variants.some((variant) => variant.from === from)) {
				variants.push({ from, to });
			}
		};

		push(move.from, move.to);
		push(encodeURIComponent(move.from), encodeURIComponent(move.to));
		push(move.from.split(path.sep).join("/"), move.to.split(path.sep).join("/"));
		return variants;
	});
}

function replaceInString(value: string, replacements: readonly { from: string; to: string }[]) {
	let result = value;
	for (const replacement of replacements) {
		if (result.includes(replacement.from)) {
			result = result.split(replacement.from).join(replacement.to);
		}
	}
	return result;
}

/** Rewrites one JSON value, touching only the strings that changed. */
function rewriteJsonValue(
	value: unknown,
	replacements: readonly { from: string; to: string }[],
	state: { changed: boolean },
): unknown {
	if (typeof value === "string") {
		const next = replaceInString(value, replacements);
		if (next !== value) {
			state.changed = true;
		}
		return next;
	}

	if (Array.isArray(value)) {
		return value.map((item) => rewriteJsonValue(item, replacements, state));
	}

	if (value && typeof value === "object") {
		const result: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
			result[key] = rewriteJsonValue(item, replacements, state);
		}
		return result;
	}

	return value;
}

/** The indentation a project file was written with, so a rewrite keeps its shape. */
function detectIndent(content: string): string {
	const match = content.match(/\n([\t ]+)\S/);
	return match?.[1] ?? "\t";
}

/**
 * Rewrites every occurrence of a moved path, returning the updated JSON text.
 *
 * The rewrite reads the values rather than the raw text: JSON escapes the
 * backslashes in a Windows path, so a plain text search would miss the very
 * references this migration has to fix.
 */
export function rewriteProjectPaths(
	content: string,
	replacements: readonly { from: string; to: string }[],
): { content: string; changed: boolean } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return { content, changed: false };
	}

	const state = { changed: false };
	const next = rewriteJsonValue(parsed, replacements, state);
	if (!state.changed) {
		return { content, changed: false };
	}

	return { content: JSON.stringify(next, null, detectIndent(content)), changed: true };
}

export type LegacyMigrationResult = {
	moved: number;
	projectsUpdated: number;
	errors: string[];
};

/**
 * Moves the old recordings into `Cache` and repoints the projects that use them.
 *
 * Never throws: a file that cannot be moved is reported and left alone, and a
 * project is only rewritten when one of its paths actually changed.
 */
export async function migrateLegacyRecordings(options: {
	rootDir: string;
	projectsDir: string;
}): Promise<LegacyMigrationResult> {
	const result: LegacyMigrationResult = { moved: 0, projectsUpdated: 0, errors: [] };
	const cacheDir = path.join(options.rootDir, "Cache");

	let entries: RecordingEntry[];
	try {
		const directory = await fs.readdir(options.rootDir, { withFileTypes: true });
		entries = directory.map((entry) => ({ name: entry.name, isFile: entry.isFile() }));
	} catch (error) {
		result.errors.push(`Could not read ${options.rootDir}: ${String(error)}`);
		return result;
	}

	let cacheNames: Set<string>;
	try {
		cacheNames = new Set((await fs.readdir(cacheDir)).map((name) => name.toLowerCase()));
	} catch {
		cacheNames = new Set();
	}

	const plan = planLegacyRecordingMigration({
		rootDir: options.rootDir,
		entries,
		cacheNames,
	});
	if (plan.moves.length === 0) {
		return result;
	}

	await fs.mkdir(cacheDir, { recursive: true });
	const completed: RecordingMove[] = [];
	for (const move of plan.moves) {
		try {
			await fs.rename(move.from, move.to);
			completed.push(move);
			result.moved += 1;
		} catch (error) {
			result.errors.push(`Could not move ${move.from}: ${String(error)}`);
		}
	}

	if (completed.length === 0) {
		return result;
	}

	const replacements = buildPathReplacements(completed);
	let projectFiles: string[] = [];
	try {
		projectFiles = (await fs.readdir(options.projectsDir)).filter((name) =>
			name.endsWith(".json"),
		);
	} catch {
		return result;
	}

	for (const name of projectFiles) {
		const filePath = path.join(options.projectsDir, name);
		try {
			const content = await fs.readFile(filePath, "utf-8");
			const rewritten = rewriteProjectPaths(content, replacements);
			if (!rewritten.changed) {
				continue;
			}

			await fs.writeFile(filePath, rewritten.content, "utf-8");
			result.projectsUpdated += 1;
		} catch (error) {
			result.errors.push(`Could not update ${filePath}: ${String(error)}`);
		}
	}

	return result;
}
