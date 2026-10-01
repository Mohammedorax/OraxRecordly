import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
	buildScreenshotFileName,
	DEFAULT_SCREENSHOT_FILE_NAME_TEMPLATE,
	formatScreenshotDate,
	withUniqueScreenshotFileName,
} from "../../src/utils/screenshotFileName";
import {
	DEFAULT_SCREENSHOT_PREFERENCES,
	readScreenshotPreferences,
	type ScreenshotPreferences,
} from "./settings/screenshotPreferencesStore";
import { getRecordingsDir } from "./utils";

export const SCREENSHOTS_DIRECTORY_NAME = "Screenshots";

/**
 * The single source of truth for "where do screenshots live". The capture
 * writer, the library listing and both `get-screenshots-folder` /
 * `open-screenshots-folder` IPC handlers resolve through this module, so they
 * can never disagree about the folder.
 */
export interface ScreenshotsFolderResolution {
	/** Absolute path captures are written to (created if it was missing). */
	path: string;
	/** True when `path` is the user's custom folder. */
	isCustom: boolean;
	/** True when a stored custom folder was rejected and the default is used. */
	fallback: boolean;
	/** Human-readable explanation for `fallback`, meant for logs and the UI. */
	fallbackReason?: string;
}

/** `<recordings dir>/Screenshots` — the default screenshots folder. */
export function getDefaultScreenshotsDir(recordingsDir: string) {
	return path.join(recordingsDir, SCREENSHOTS_DIRECTORY_NAME);
}

/** Reads the preferences, falling back to the documented defaults on failure. */
export async function readScreenshotPreferencesSafe(): Promise<ScreenshotPreferences> {
	try {
		return await readScreenshotPreferences();
	} catch {
		return DEFAULT_SCREENSHOT_PREFERENCES;
	}
}

/**
 * A custom folder must be an absolute path pointing at (or creatable as) a
 * writable directory. Anything else throws with a message that says exactly why.
 */
async function assertUsableScreenshotsDirectory(dir: string): Promise<void> {
	if (!path.isAbsolute(dir)) {
		throw new Error(`"${dir}" is not an absolute path`);
	}

	await fs.mkdir(dir, { recursive: true });
	const stat = await fs.stat(dir);
	if (!stat.isDirectory()) {
		throw new Error(`"${dir}" is not a directory`);
	}

	await fs.access(dir, fsConstants.W_OK);
}

/**
 * Resolves the folder captures go into. A stored custom folder that is missing,
 * relative or unusable does not fail the capture: the default folder is used and
 * the reason is reported so the caller can surface it.
 */
export async function resolveScreenshotsFolder(): Promise<ScreenshotsFolderResolution> {
	const defaultDir = getDefaultScreenshotsDir(await getRecordingsDir());
	const preferences = await readScreenshotPreferencesSafe();
	const customFolder = preferences.folder;

	if (customFolder) {
		try {
			await assertUsableScreenshotsDirectory(customFolder);
			return { path: customFolder, isCustom: true, fallback: false };
		} catch (error) {
			const reason = `The configured screenshots folder is unusable (${
				error instanceof Error ? error.message : String(error)
			}); captures are saved to the default folder instead.`;
			console.warn(reason);
			await fs.mkdir(defaultDir, { recursive: true });
			return {
				path: defaultDir,
				isCustom: false,
				fallback: true,
				fallbackReason: reason,
			};
		}
	}

	await fs.mkdir(defaultDir, { recursive: true });
	return { path: defaultDir, isCustom: false, fallback: false };
}

/**
 * Per-day counter for `{counter}`: how many files already in the folder carry
 * today's date stamp, plus one. It is only a hint — collisions are still broken
 * by the uniqueness suffix — but it makes the token useful without extra state.
 */
function nextDailyCounter(existingNames: readonly string[], date: Date): number {
	const stamp = formatScreenshotDate(date);
	let count = 0;
	for (const name of existingNames) {
		if (name.includes(stamp)) {
			count += 1;
		}
	}

	return count + 1;
}

export interface ScreenshotWriteTarget {
	filePath: string;
	folder: ScreenshotsFolderResolution;
}

/**
 * Builds the absolute path a capture should be written to: resolves the folder,
 * renders the (sanitized) file-name template, applies the per-day counter and
 * finally appends a ` (2)`, ` (3)`, … suffix when the name is already taken, so
 * an existing screenshot is never overwritten.
 */
export async function buildScreenshotWritePath(
	date: Date,
	options: {
		fileNameTemplate?: string;
		appName?: string | null;
		extension?: string;
	} = {},
): Promise<ScreenshotWriteTarget> {
	const folder = await resolveScreenshotsFolder();
	const existingNames = await fs.readdir(folder.path).catch(() => [] as string[]);
	const fileName = buildScreenshotFileName(
		date,
		options.fileNameTemplate ?? DEFAULT_SCREENSHOT_FILE_NAME_TEMPLATE,
		{
			counter: nextDailyCounter(existingNames, date),
			appName: options.appName ?? null,
			extension: options.extension,
		},
	);

	return {
		filePath: path.join(folder.path, withUniqueScreenshotFileName(fileName, existingNames)),
		folder,
	};
}

/**
 * Writes the screenshot at its planned path, refusing to overwrite an existing
 * file (`wx`). The planned path already accounts for the names present a moment
 * ago, so the retry only matters when a name appeared in between (or two
 * captures raced); it then takes the next ` (n)` suffix.
 */
export async function writeScreenshotFileExclusive(
	filePath: string,
	buffer: Uint8Array,
): Promise<string> {
	const directory = path.dirname(filePath);
	const fileName = path.basename(filePath);
	const taken: string[] = [];
	let candidate = fileName;

	for (let attempt = 0; attempt < 1000; attempt += 1) {
		const target = path.join(directory, candidate);
		try {
			await fs.writeFile(target, buffer, { flag: "wx" });
			return target;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
				throw error;
			}
			taken.push(candidate);
			candidate = withUniqueScreenshotFileName(fileName, taken);
		}
	}

	throw new Error(`Could not find a free screenshot file name for "${fileName}".`);
}
