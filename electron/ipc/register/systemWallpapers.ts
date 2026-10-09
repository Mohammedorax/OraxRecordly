import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { app, dialog, ipcMain } from "electron";
import { USER_DATA_PATH } from "../../appPaths";
import { HIDDEN_WINDOW_OPTIONS } from "../../childProcess";
import { buildMediaUrl, ensureMediaServer } from "../../mediaServer";
import { rememberApprovedLocalReadPath } from "../project/manager";
import {
	collectSystemWallpaperImages,
	createSystemWallpaperImage,
	detectImageExtensionFromBytes,
	extractRegistryBinary,
	extractRegistryString,
	parseTranscodedImageCachePath,
	SYSTEM_WALLPAPER_IMAGE_EXTENSIONS,
	SYSTEM_WALLPAPER_MAX_FILE_BYTES,
	SYSTEM_WALLPAPER_MAX_RESULTS,
	type SystemWallpaperImage,
	type SystemWallpaperRoot,
} from "../systemWallpapers";
import type {
	SystemWallpaperEntry,
	SystemWallpaperListResult,
	SystemWallpaperPickResult,
} from "../types";

const execFileAsync = promisify(execFile);

export const LIST_SYSTEM_WALLPAPERS_CHANNEL = "list-system-wallpapers";
export const PICK_SYSTEM_WALLPAPER_IMAGE_CHANNEL = "pick-system-wallpaper-image";

/** Extensionless Windows theme caches are only used when their bytes prove they are images. */
const OPAQUE_WALLPAPER_COPY_DIR = path.join(USER_DATA_PATH, "wallpaper-cache");
const OPAQUE_WALLPAPER_COPY_NAME = "current-desktop-wallpaper";

/**
 * Current desktop wallpaper on Windows.
 *
 * Sources, in order of usefulness (all read through `reg.exe query`, the least
 * invasive option that needs no native bindings):
 *
 * 1. `HKCU\Control Panel\Desktop\Wallpaper` — the same value
 *    `SystemParametersInfo(SPI_GETDESKWALLPAPER)` returns. On Windows 10/11 it
 *    is frequently empty or points at the extensionless `TranscodedWallpaper`.
 * 2. `HKCU\Control Panel\Desktop\TranscodedImageCache` — a REG_BINARY blob whose
 *    tail carries the *original* source path as UTF-16LE, which keeps the
 *    wallpaper dedupable against the system wallpaper folders.
 * 3. `%APPDATA%\Microsoft\Windows\Themes\TranscodedWallpaper` — last resort.
 *
 * Extensionless candidates are only used when their magic bytes prove they are
 * images; the copy is written into userData with a real extension.
 *
 * macOS (`desktoppicture.db` / System Events) and Linux desktop configuration
 * are too brittle to read reliably, so those platforms return null and the
 * picker falls back to the wallpaper folders plus Pictures.
 */
export async function resolveCurrentDesktopWallpaperPath(): Promise<string | null> {
	if (process.platform !== "win32") {
		return null;
	}

	const registry = await queryWindowsDesktopRegistry();
	const candidates = [
		registry.wallpaper,
		parseTranscodedImageCachePath(registry.transcodedImageCache),
		defaultTranscodedWallpaperPath(),
	].filter((candidate): candidate is string => Boolean(candidate));

	// Prefer a candidate that already is an image file: those stay identical to
	// the file the user picked, so they dedupe against the wallpaper folders.
	for (const candidate of candidates) {
		const resolved = await fs.realpath(candidate).catch(() => null);
		if (resolved && hasImageExtension(resolved)) {
			return resolved;
		}
	}

	// Then fall back to opaque Windows caches, which we copy with an extension.
	for (const candidate of candidates) {
		const resolved = await fs.realpath(candidate).catch(() => null);
		if (!resolved) {
			continue;
		}

		const materialized = await materializeOpaqueWallpaper(resolved);
		if (materialized) {
			return materialized;
		}
	}

	return null;
}

export interface WindowsDesktopRegistryValues {
	wallpaper: string | null;
	transcodedImageCache: string | null;
}

export function hasImageExtension(filePath: string): boolean {
	const lowered = filePath.toLowerCase();
	return SYSTEM_WALLPAPER_IMAGE_EXTENSIONS.some((extension) => lowered.endsWith(extension));
}

function defaultTranscodedWallpaperPath(): string | null {
	const appDataPath = safeUserPath("appData");
	return appDataPath
		? path.join(appDataPath, "Microsoft", "Windows", "Themes", "TranscodedWallpaper")
		: null;
}

/** One `reg query` returns both the string value and the binary cache. */
export async function queryWindowsDesktopRegistry(): Promise<WindowsDesktopRegistryValues> {
	try {
		const { stdout } = await execFileAsync(
			"reg.exe",
			["query", "HKCU\\Control Panel\\Desktop"],
			HIDDEN_WINDOW_OPTIONS,
		);
		return {
			wallpaper: extractRegistryString(stdout, "Wallpaper"),
			transcodedImageCache: extractRegistryBinary(stdout, "TranscodedImageCache"),
		};
	} catch (error) {
		console.warn(
			"[system-wallpapers] Could not read the desktop wallpaper registry value:",
			error,
		);
		return { wallpaper: null, transcodedImageCache: null };
	}
}

async function materializeOpaqueWallpaper(sourcePath: string): Promise<string | null> {
	try {
		const stats = await fs.stat(sourcePath);
		if (!stats.isFile() || stats.size <= 0 || stats.size > SYSTEM_WALLPAPER_MAX_FILE_BYTES) {
			return null;
		}

		const handle = await fs.open(sourcePath, "r");
		let header: Buffer;
		try {
			header = Buffer.alloc(16);
			await handle.read(header, 0, header.length, 0);
		} finally {
			await handle.close();
		}

		const extension = detectImageExtensionFromBytes(header);
		if (!extension) {
			return null;
		}

		await fs.mkdir(OPAQUE_WALLPAPER_COPY_DIR, { recursive: true });
		const targetPath = path.join(
			OPAQUE_WALLPAPER_COPY_DIR,
			`${OPAQUE_WALLPAPER_COPY_NAME}${extension}`,
		);
		await fs.copyFile(sourcePath, targetPath);
		return targetPath;
	} catch (error) {
		console.warn("[system-wallpapers] Could not materialise the desktop wallpaper:", error);
		return null;
	}
}

function safeUserPath(name: "pictures" | "appData"): string | null {
	try {
		const value = app.getPath(name);
		return typeof value === "string" && value.length > 0 ? value : null;
	} catch {
		return null;
	}
}

/** Platform-specific roots, ordered so the most useful images come first. */
export function buildSystemWallpaperRoots(): SystemWallpaperRoot[] {
	const picturesPath = safeUserPath("pictures");
	const roots: SystemWallpaperRoot[] = [];

	if (process.platform === "win32") {
		const appDataPath = safeUserPath("appData");
		if (appDataPath) {
			roots.push({
				dir: path.join(appDataPath, "Microsoft", "Windows", "Themes"),
				source: "themes",
				maxDepth: 3,
			});
		}

		const windowsDir = process.env["WINDIR"] ?? process.env["SystemRoot"];
		if (windowsDir) {
			roots.push({
				dir: path.join(windowsDir, "Web", "Wallpaper"),
				source: "system",
				maxDepth: 3,
			});
		}
	} else if (process.platform === "darwin") {
		roots.push({ dir: "/System/Library/Desktop Pictures", source: "system", maxDepth: 2 });
		roots.push({ dir: "/Library/Desktop Pictures", source: "system", maxDepth: 2 });
	} else {
		const home = process.env["HOME"];
		if (home) {
			roots.push({
				dir: path.join(home, ".local", "share", "backgrounds"),
				source: "system",
				maxDepth: 2,
			});
		}
		roots.push({ dir: "/usr/share/backgrounds", source: "system", maxDepth: 2 });
	}

	if (picturesPath) {
		roots.push({ dir: picturesPath, source: "pictures", maxDepth: 2 });
	}

	return roots;
}

async function attachRendererUrl(image: SystemWallpaperImage): Promise<SystemWallpaperEntry> {
	let url = "";
	try {
		await rememberApprovedLocalReadPath(image.path);
		const baseUrl = await ensureMediaServer();
		url = buildMediaUrl(baseUrl, image.path);
	} catch (error) {
		// The renderer still has the thumbnail IPC and `read-local-file` fallbacks.
		console.warn("[system-wallpapers] Failed to build a media URL for", image.path, error);
	}

	return { ...image, url };
}

export async function listSystemWallpaperImages(): Promise<
	Omit<SystemWallpaperListResult, "success">
> {
	const desktopPath = await resolveCurrentDesktopWallpaperPath();
	const desktopImage = desktopPath
		? await createSystemWallpaperImage(desktopPath, "desktop")
		: null;

	const { images, truncated } = await collectSystemWallpaperImages({
		roots: buildSystemWallpaperRoots(),
		maxResults: SYSTEM_WALLPAPER_MAX_RESULTS,
	});

	const merged: SystemWallpaperImage[] = [];
	const seen = new Set<string>();
	for (const image of [desktopImage, ...images]) {
		if (!image) continue;
		const key = image.path.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(image);
	}

	const withUrls = await Promise.all(merged.map((image) => attachRendererUrl(image)));
	return { images: withUrls, truncated };
}

export function registerSystemWallpaperHandlers() {
	ipcMain.handle(LIST_SYSTEM_WALLPAPERS_CHANNEL, async (): Promise<SystemWallpaperListResult> => {
		try {
			const result = await listSystemWallpaperImages();
			return { success: true, ...result };
		} catch (error) {
			console.error("[system-wallpapers] Failed to list images:", error);
			return { success: false, images: [], error: String(error) };
		}
	});

	ipcMain.handle(
		PICK_SYSTEM_WALLPAPER_IMAGE_CHANNEL,
		async (): Promise<SystemWallpaperPickResult> => {
			try {
				const result = await dialog.showOpenDialog({
					title: "Choose background image",
					properties: ["openFile"],
					filters: [
						{
							name: "Images",
							extensions: SYSTEM_WALLPAPER_IMAGE_EXTENSIONS.map((extension) =>
								extension.replace(/^\./, ""),
							),
						},
					],
				});

				const selectedPath = result.filePaths[0];
				if (result.canceled || !selectedPath) {
					return { success: false, canceled: true };
				}

				const image = await createSystemWallpaperImage(selectedPath, "browse");
				if (!image) {
					return { success: false, error: "Unsupported image file" };
				}

				return { success: true, image: await attachRendererUrl(image) };
			} catch (error) {
				console.error("[system-wallpapers] Image picker failed:", error);
				return { success: false, error: String(error) };
			}
		},
	);
}
