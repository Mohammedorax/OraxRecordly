import fs from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
import path from "node:path";
import type { SystemWallpaperSource } from "./types";

/**
 * Discovery of images that already exist on the user's machine so the wallpaper
 * picker can offer them next to the bundled wallpapers.
 *
 * Everything in this module is deliberately free of Electron imports: the IPC
 * wrapper that needs `app`/`dialog` lives in `register/systemWallpapers.ts`, and
 * the pure filtering/capping/humanising logic below is unit-testable on its own.
 */

export const SYSTEM_WALLPAPER_IMAGE_EXTENSIONS = [
	".png",
	".jpg",
	".jpeg",
	".webp",
	".bmp",
	".gif",
] as const;

/** Images larger than this are skipped: a wallpaper grid should never stream a 200 MB file. */
export const SYSTEM_WALLPAPER_MAX_FILE_BYTES = 40 * 1024 * 1024;
/** Hard cap on returned entries so a big Pictures library cannot flood the picker. */
export const SYSTEM_WALLPAPER_MAX_RESULTS = 60;
/** Recursion depth relative to each root. */
export const SYSTEM_WALLPAPER_MAX_DEPTH = 3;
/** Hard cap on the number of directory entries examined while walking. */
export const SYSTEM_WALLPAPER_MAX_VISITED_FILES = 4000;

export interface SystemWallpaperImage {
	/** Absolute path on disk. This is what gets persisted in the project. */
	path: string;
	/** Humanised file name (or the desktop label decided by the renderer). */
	name: string;
	/** Where the image came from; the renderer localises the "desktop" case. */
	source: SystemWallpaperSource;
}

export interface SystemWallpaperRoot {
	dir: string;
	source: SystemWallpaperSource;
	maxDepth?: number;
}

export interface CollectSystemWallpaperOptions {
	roots: SystemWallpaperRoot[];
	maxResults?: number;
	maxFileBytes?: number;
	maxDepth?: number;
	maxVisitedFiles?: number;
	platform?: NodeJS.Platform;
}

export interface CollectSystemWallpaperResult {
	images: SystemWallpaperImage[];
	/** True when the walk stopped early because of a cap. */
	truncated: boolean;
}

const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|webp|bmp|gif)$/i;

export function getSystemWallpaperExtension(fileName: string): string {
	return path.extname(fileName).toLowerCase();
}

/** Extension-only check; the file still has to exist and stay under the size cap. */
export function isSupportedSystemWallpaperImage(fileName: string): boolean {
	return IMAGE_EXTENSION_PATTERN.test(fileName);
}

export function isAcceptedSystemWallpaperFile(
	fileName: string,
	size: number,
	maxFileBytes: number = SYSTEM_WALLPAPER_MAX_FILE_BYTES,
): boolean {
	if (!isSupportedSystemWallpaperImage(fileName)) {
		return false;
	}

	return Number.isFinite(size) && size > 0 && size <= maxFileBytes;
}

/**
 * File name -> display name. Windows theme caches are named
 * `CachedImage_<width>_<height>_<n>.jpg`, so that prefix is dropped first.
 *
 * The input may be a full path from the Windows registry (`C:\...\x.jpg`), which
 * must be split on `\` even when these tests run on a POSIX host, so the leaf is
 * extracted without the platform-dependent `path.basename`.
 */
export function humanizeSystemWallpaperName(fileName: string): string {
	const leafName = fileName.split(/[\\/]/).pop() ?? "";
	const baseName = leafName.replace(/\.[^.]+$/, "").trim();
	if (!baseName) {
		return "Wallpaper image";
	}

	const spaced = baseName
		.replace(/^cachedimage[_-]?/i, "")
		.replace(/[_-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (!spaced) {
		return "Wallpaper image";
	}

	const titled = spaced.replace(/\b\p{L}/gu, (match) => match.toUpperCase());
	return titled.length > 72 ? `${titled.slice(0, 69)}...` : titled;
}

/** Case-insensitive key used to dedupe the same image found through several roots. */
export function normalizeSystemWallpaperKey(
	filePath: string,
	platform: NodeJS.Platform = process.platform,
): string {
	const normalized = path.normalize(filePath);
	return platform === "win32" ? normalized.toLowerCase() : normalized;
}

/** Reads a `REG_SZ`/`REG_EXPAND_SZ` value out of `reg.exe query` output. */
export function extractRegistryString(output: string, valueName: string): string | null {
	const pattern = new RegExp(`^\\s*${valueName}\\s+REG_(?:EXPAND_)?SZ\\s+(.*)$`, "im");
	const value = output.match(pattern)?.[1]?.trim();
	return value && value.length > 0 ? value : null;
}

/** Reads the raw hex payload of a `REG_BINARY` value out of `reg.exe query` output. */
export function extractRegistryBinary(output: string, valueName: string): string | null {
	const pattern = new RegExp(`^\\s*${valueName}\\s+REG_BINARY\\s+(.*)$`, "im");
	const value = output.match(pattern)?.[1]?.trim();
	return value && value.length > 0 ? value : null;
}

/**
 * `HKCU\Control Panel\Desktop\TranscodedImageCache` is a REG_BINARY blob that
 * stores a fixed-size header followed by the original wallpaper path encoded as
 * UTF-16LE. Returns that path, or null when the blob is unusable.
 */
export function parseTranscodedImageCachePath(hexValue: string | null): string | null {
	if (!hexValue) {
		return null;
	}

	const normalized = hexValue.replace(/\s+/g, "");
	if (normalized.length === 0 || normalized.length % 2 !== 0 || /[^0-9a-f]/i.test(normalized)) {
		return null;
	}

	const decoded = Buffer.from(normalized, "hex").toString("utf16le");
	const match = decoded.match(/[A-Za-z]:[\\/][^<>"|?*]*/);
	if (!match) {
		return null;
	}

	// The UTF-16LE payload is NUL-padded; cut at the first control character
	// instead of embedding control-code ranges in the pattern.
	let raw = match[0];
	for (let index = 0; index < raw.length; index++) {
		const code = raw.charCodeAt(index);
		if (code < 0x20 || code === 0x7f) {
			raw = raw.slice(0, index);
			break;
		}
	}

	const candidate = raw.trim();
	return candidate.length > 3 ? candidate : null;
}

/** Sniffs an image container so an extensionless registry target can be materialised. */
export function detectImageExtensionFromBytes(bytes: Uint8Array): string | null {
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return ".jpg";
	}

	if (
		bytes.length >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	) {
		return ".png";
	}

	if (bytes.length >= 6) {
		const header = String.fromCharCode(...bytes.subarray(0, 6));
		if (header === "GIF87a" || header === "GIF89a") {
			return ".gif";
		}
	}

	if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
		return ".bmp";
	}

	if (
		bytes.length >= 12 &&
		String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
		String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
	) {
		return ".webp";
	}

	return null;
}

interface WalkState {
	visitedFiles: number;
	truncated: boolean;
}

async function walkRoot(
	root: SystemWallpaperRoot,
	options: Required<Pick<CollectSystemWallpaperOptions, "maxDepth" | "maxVisitedFiles">>,
	state: WalkState,
	seen: Set<string>,
	images: SystemWallpaperImage[],
	maxResults: number,
	maxFileBytes: number,
	platform: NodeJS.Platform,
): Promise<void> {
	if (images.length >= maxResults || state.visitedFiles >= options.maxVisitedFiles) {
		state.truncated = true;
		return;
	}

	const depthLimit = Math.max(0, root.maxDepth ?? options.maxDepth);
	const queue: Array<{ dir: string; depth: number }> = [{ dir: root.dir, depth: 0 }];

	while (queue.length > 0) {
		if (images.length >= maxResults) {
			state.truncated = true;
			return;
		}

		if (state.visitedFiles >= options.maxVisitedFiles) {
			state.truncated = true;
			return;
		}

		const current = queue.shift();
		if (!current) {
			return;
		}

		let entries: Dirent[];
		try {
			entries = await fs.readdir(current.dir, { withFileTypes: true });
		} catch {
			// Missing or unreadable folders are expected (themes, Pictures, caches).
			continue;
		}

		for (const entry of entries) {
			if (state.visitedFiles >= options.maxVisitedFiles) {
				state.truncated = true;
				return;
			}
			state.visitedFiles++;

			const entryPath = path.join(current.dir, entry.name);

			if (entry.isDirectory()) {
				if (current.depth < depthLimit) {
					queue.push({ dir: entryPath, depth: current.depth + 1 });
				}
				continue;
			}

			if (!entry.isFile() || !isSupportedSystemWallpaperImage(entry.name)) {
				continue;
			}

			let stats: Stats;
			try {
				stats = await fs.stat(entryPath);
			} catch {
				continue;
			}

			if (!isAcceptedSystemWallpaperFile(entry.name, stats.size, maxFileBytes)) {
				continue;
			}

			// Resolve symlinks before deduping so a linked copy is not offered twice.
			const realPath = await fs.realpath(entryPath).catch(() => entryPath);
			const dedupeKey = normalizeSystemWallpaperKey(realPath, platform);
			if (seen.has(dedupeKey)) {
				continue;
			}
			seen.add(dedupeKey);

			images.push({
				path: path.normalize(realPath),
				name: humanizeSystemWallpaperName(entry.name),
				source: root.source,
			});

			if (images.length >= maxResults) {
				state.truncated = true;
				return;
			}
		}
	}
}

/**
 * Walks the given roots and returns at most `maxResults` usable images.
 * Never throws: missing, unreadable or enormous folders are skipped.
 */
export async function collectSystemWallpaperImages(
	options: CollectSystemWallpaperOptions,
): Promise<CollectSystemWallpaperResult> {
	const maxResults = options.maxResults ?? SYSTEM_WALLPAPER_MAX_RESULTS;
	const maxFileBytes = options.maxFileBytes ?? SYSTEM_WALLPAPER_MAX_FILE_BYTES;
	const maxDepth = options.maxDepth ?? SYSTEM_WALLPAPER_MAX_DEPTH;
	const maxVisitedFiles = options.maxVisitedFiles ?? SYSTEM_WALLPAPER_MAX_VISITED_FILES;
	const platform = options.platform ?? process.platform;

	const seen = new Set<string>();
	const images: SystemWallpaperImage[] = [];
	const state: WalkState = { visitedFiles: 0, truncated: false };

	for (const root of options.roots) {
		if (images.length >= maxResults) {
			state.truncated = true;
			break;
		}

		await walkRoot(
			root,
			{ maxDepth, maxVisitedFiles },
			state,
			seen,
			images,
			maxResults,
			maxFileBytes,
			platform,
		);
	}

	return { images, truncated: state.truncated };
}

/** Builds a single picker entry for a user-chosen or registry-discovered file. */
export async function createSystemWallpaperImage(
	filePath: string,
	source: SystemWallpaperSource,
	maxFileBytes: number = SYSTEM_WALLPAPER_MAX_FILE_BYTES,
): Promise<SystemWallpaperImage | null> {
	let realPath: string;
	try {
		realPath = await fs.realpath(filePath);
	} catch {
		return null;
	}

	let stats: Stats;
	try {
		stats = await fs.stat(realPath);
	} catch {
		return null;
	}

	if (!stats.isFile() || !isAcceptedSystemWallpaperFile(realPath, stats.size, maxFileBytes)) {
		return null;
	}

	return {
		path: path.normalize(realPath),
		name: humanizeSystemWallpaperName(realPath),
		source,
	};
}
