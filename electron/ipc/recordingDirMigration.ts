import fs from "node:fs/promises";
import path from "node:path";
import { RECORDINGS_DIR, USER_DATA_PATH } from "../appPaths";

/**
 * One-time move of the recordings library out of the hidden AppData folder into
 * the user's visible Videos folder.
 *
 * Safety rules:
 * - The move is only ever an instant same-volume rename; we never silently copy
 *   or merge gigabytes of user media at startup.
 * - If the legacy folder has data and the target is already in use, we keep the
 *   legacy folder and warn — an existing library is never orphaned.
 * - On success a marker file makes the migration run once per install.
 */
const MIGRATION_MARKER_PATH = path.join(USER_DATA_PATH, "recordings-dir-migration-v1.json");

export type RecordingsMigrationDecision = "use-target" | "move" | "stay-legacy";

/** Pure policy, unit-tested separately from the filesystem work. */
export function decideRecordingsMigration(input: {
	customDir: string | null;
	targetDir: string;
	legacyExists: boolean;
	legacyEntryCount: number;
	targetExists: boolean;
	targetEntryCount: number;
	alreadyMigrated: boolean;
}): RecordingsMigrationDecision {
	if (input.customDir) return "use-target";
	if (input.targetDir === RECORDINGS_DIR) return "use-target";
	if (input.alreadyMigrated) return "use-target";
	if (!input.legacyExists || input.legacyEntryCount === 0) return "use-target";
	if (!input.targetExists || input.targetEntryCount === 0) return "move";
	return "stay-legacy";
}

async function listEntryNames(dir: string): Promise<string[] | null> {
	try {
		return await fs.readdir(dir);
	} catch {
		return null;
	}
}

async function hasMigrationMarker(): Promise<boolean> {
	try {
		await fs.access(MIGRATION_MARKER_PATH);
		return true;
	} catch {
		return false;
	}
}

async function writeMigrationMarker(payload: Record<string, unknown>): Promise<void> {
	try {
		await fs.mkdir(USER_DATA_PATH, { recursive: true });
		await fs.writeFile(
			MIGRATION_MARKER_PATH,
			JSON.stringify({ version: 1, at: new Date().toISOString(), ...payload }, null, 2),
			"utf8",
		);
	} catch {
		// A missing marker only means we may re-check on the next launch.
	}
}

/**
 * Ensures `targetDir` can host the library. Returns false when legacy data
 * exists but could not be moved — the caller must then stay on the legacy dir.
 */
export async function migrateRecordingsDirectoryOnce(options: {
	customDir: string | null;
	targetDir: string;
}): Promise<boolean> {
	const legacyEntries = await listEntryNames(RECORDINGS_DIR);
	const targetEntries = await listEntryNames(options.targetDir);
	const decision = decideRecordingsMigration({
		customDir: options.customDir,
		targetDir: options.targetDir,
		legacyExists: legacyEntries !== null,
		legacyEntryCount: legacyEntries?.length ?? 0,
		targetExists: targetEntries !== null,
		targetEntryCount: targetEntries?.length ?? 0,
		alreadyMigrated: await hasMigrationMarker(),
	});

	if (decision === "use-target") {
		await fs.mkdir(options.targetDir, { recursive: true });
		if (legacyEntries === null) {
			await writeMigrationMarker({ mode: "no-legacy", targetDir: options.targetDir });
		}
		return true;
	}

	if (decision === "stay-legacy") {
		console.warn(
			`[recordings-migration] ${options.targetDir} already contains files; keeping the existing library at ${RECORDINGS_DIR}. Choose a recordings folder in settings to move it.`,
		);
		return false;
	}

	try {
		await fs.mkdir(path.dirname(options.targetDir), { recursive: true });
		if (targetEntries !== null) {
			// Only ever an empty directory, so this cannot drop user data.
			await fs.rmdir(options.targetDir);
		}
		await fs.rename(RECORDINGS_DIR, options.targetDir);
		await writeMigrationMarker({ mode: "move", targetDir: options.targetDir });
		console.info(`[recordings-migration] Moved the recordings library to ${options.targetDir}`);
		return true;
	} catch (error) {
		console.warn(
			`[recordings-migration] Could not move ${RECORDINGS_DIR} to ${options.targetDir}; keeping the existing location`,
			error,
		);
		return false;
	}
}
