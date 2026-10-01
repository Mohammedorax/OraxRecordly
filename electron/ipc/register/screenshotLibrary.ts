import fs from "node:fs/promises";
import path from "node:path";
import { ipcMain, shell } from "electron";
import { buildMediaUrl, getMediaServerBaseUrl } from "../../mediaServer";
import { rememberApprovedLocalReadPath } from "../project/manager";
import { resolveScreenshotsFolder } from "../screenshotStorage";
import type { ScreenshotLibraryEntry } from "../../../src/types/screenshotLibrary";

// Captures can be saved as PNG or JPEG (see the format preference), so both
// must be listed here and both must pass the delete path guard below.
const isScreenshot = (name: string) => /\.(png|jpe?g)$/i.test(name);

/**
 * Real path of the screenshots folder, or null when it does not exist yet. Uses
 * the same resolver as the capture path, so the library always lists exactly the
 * folder captures are written to (including a custom folder).
 */
async function resolveScreenshotsRoot() {
	const { path: screenshotsDir } = await resolveScreenshotsFolder();
	return await fs.realpath(screenshotsDir).catch(() => null);
}

/** List saved screenshots newest first, mirroring the recordings library. */
export async function listScreenshots(): Promise<ScreenshotLibraryEntry[]> {
	const root = await resolveScreenshotsRoot();
	if (!root) return [];
	const server = getMediaServerBaseUrl();
	const entries = await fs.readdir(root, { withFileTypes: true });
	const result: ScreenshotLibraryEntry[] = [];
	for (const entry of entries) {
		if (!entry.isFile() || !isScreenshot(entry.name)) continue;
		const filePath = path.join(root, entry.name);
		const stat = await fs.stat(filePath);
		if (!stat.size) continue;
		await rememberApprovedLocalReadPath(filePath);
		result.push({
			path: filePath,
			name: entry.name,
			modifiedMs: stat.mtimeMs,
			sizeBytes: stat.size,
			url: server ? buildMediaUrl(server, filePath) : "",
		});
	}
	return result.sort((a, b) => b.modifiedMs - a.modifiedMs);
}

/**
 * Send one screenshot to the OS Trash. The path must resolve to a real PNG file
 * directly inside the screenshots folder; `fs.realpath` resolves symlinks first,
 * so a link that escapes the folder is rejected.
 */
export async function deleteScreenshot(filePath: string): Promise<void> {
	if (typeof filePath !== "string" || !filePath.trim())
		throw new Error("A screenshot path is required");
	const root = await resolveScreenshotsRoot();
	if (!root) throw new Error("Screenshot is outside the Screenshots library");
	const resolved = await fs.realpath(filePath).catch(() => path.resolve(filePath));
	if (path.dirname(resolved) !== root || !isScreenshot(path.basename(resolved)))
		throw new Error("Screenshot is outside the Screenshots library");
	await shell.trashItem(resolved);
}

export function registerScreenshotLibraryHandlers() {
	ipcMain.handle("list-screenshots", async () => {
		try {
			return { success: true, value: await listScreenshots() };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});
	ipcMain.handle("delete-screenshot", async (_, filePath: string) => {
		try {
			await deleteScreenshot(filePath);
			return { success: true, value: null };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});
}
