import fs from "node:fs/promises";
import path from "node:path";
import { getDefaultExportDir } from "../../appPaths";

const MAX_RENAME_ATTEMPTS = 999;
const WINDOWS_INVALID_FILE_NAME_CHARS = '<>:"/\\|?*';

/** Strips characters Windows rejects so a project name can never break the save. */
export function sanitizeExportFileName(fileName: string): string {
	const baseName = Array.from(path.basename(fileName))
		.filter(
			(char) => char.charCodeAt(0) >= 32 && !WINDOWS_INVALID_FILE_NAME_CHARS.includes(char),
		)
		.join("")
		.trim();
	return baseName || "export.mp4";
}

/** Picks `name.mp4`, `name (2).mp4`, … so an export never overwrites an existing file. */
export async function resolveAvailableExportPath(
	directoryPath: string,
	fileName: string,
): Promise<string> {
	const safeName = sanitizeExportFileName(fileName);
	const extension = path.extname(safeName);
	const stem = safeName.slice(0, safeName.length - extension.length) || "export";

	for (let index = 1; index <= MAX_RENAME_ATTEMPTS; index += 1) {
		const candidateName =
			index === 1 ? `${stem}${extension}` : `${stem} (${index})${extension}`;
		const candidatePath = path.join(directoryPath, candidateName);
		try {
			await fs.access(candidatePath);
		} catch {
			return candidatePath;
		}
	}

	return path.join(directoryPath, `${stem}-${Date.now()}${extension}`);
}

/** Exports live in a dedicated subfolder so they never appear in the library. */
export async function ensureExportDirectory(recordingsDir: string): Promise<string> {
	const exportDir = getDefaultExportDir(recordingsDir);
	await fs.mkdir(exportDir, { recursive: true });
	return exportDir;
}
