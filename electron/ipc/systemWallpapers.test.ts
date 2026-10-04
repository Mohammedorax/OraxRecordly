import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	collectSystemWallpaperImages,
	createSystemWallpaperImage,
	detectImageExtensionFromBytes,
	extractRegistryBinary,
	extractRegistryString,
	humanizeSystemWallpaperName,
	isAcceptedSystemWallpaperFile,
	isSupportedSystemWallpaperImage,
	normalizeSystemWallpaperKey,
	parseTranscodedImageCachePath,
} from "./systemWallpapers";

function buildTranscodedImageCacheHex(filePath: string): string {
	// Real dumps are a binary header followed by the source path as UTF-16LE.
	const header = Buffer.from([0x7a, 0xc3, 0x01, 0x00, 0x84, 0x1c, 0x15, 0x00]);
	const pathBytes = Buffer.from(`${filePath}\0\0`, "utf16le");
	return Buffer.concat([header, pathBytes]).toString("hex").toUpperCase();
}

describe("system wallpaper filtering", () => {
	it("accepts only the supported image extensions", () => {
		for (const fileName of [
			"photo.png",
			"photo.JPG",
			"photo.jpeg",
			"photo.webp",
			"photo.bmp",
			"photo.gif",
		]) {
			expect(isSupportedSystemWallpaperImage(fileName)).toBe(true);
		}

		for (const fileName of [
			"clip.mp4",
			"notes.txt",
			"icon.svg",
			"photo.avif",
			// Windows keeps the live desktop wallpaper in an extensionless file.
			"TranscodedWallpaper",
			"noextension",
		]) {
			expect(isSupportedSystemWallpaperImage(fileName)).toBe(false);
		}
	});

	it("rejects empty and oversized files", () => {
		expect(isAcceptedSystemWallpaperFile("a.jpg", 0, 1024)).toBe(false);
		expect(isAcceptedSystemWallpaperFile("a.jpg", 1024, 1024)).toBe(true);
		expect(isAcceptedSystemWallpaperFile("a.jpg", 1025, 1024)).toBe(false);
		expect(isAcceptedSystemWallpaperFile("a.txt", 10, 1024)).toBe(false);
		expect(isAcceptedSystemWallpaperFile("a.jpg", Number.NaN, 1024)).toBe(false);
	});

	it("humanises file names for display", () => {
		expect(humanizeSystemWallpaperName("sonoma-clouds.jpg")).toBe("Sonoma Clouds");
		expect(humanizeSystemWallpaperName("wallpaper_4.PNG")).toBe("Wallpaper 4");
		expect(humanizeSystemWallpaperName("C:\\Wallpapers\\CachedImage_1920_1080_4.jpg")).toBe(
			"1920 1080 4",
		);
		// The leaf must also be found with forward slashes so the helper behaves
		// the same on a POSIX host as it does on Windows.
		expect(humanizeSystemWallpaperName("/usr/share/backgrounds/adwaita-d.jpg")).toBe(
			"Adwaita D",
		);
		expect(humanizeSystemWallpaperName(".jpg")).toBe("Wallpaper image");
	});

	it("detects image containers from their magic bytes", () => {
		expect(detectImageExtensionFromBytes(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
			".jpg",
		);
		expect(
			detectImageExtensionFromBytes(
				Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			),
		).toBe(".png");
		expect(detectImageExtensionFromBytes(new TextEncoder().encode("GIF89a1234"))).toBe(".gif");
		expect(detectImageExtensionFromBytes(Uint8Array.from([0x42, 0x4d, 0x00, 0x00]))).toBe(
			".bmp",
		);
		expect(detectImageExtensionFromBytes(new TextEncoder().encode("RIFFxxxxWEBPVP8 "))).toBe(
			".webp",
		);
		expect(detectImageExtensionFromBytes(new TextEncoder().encode("not an image"))).toBeNull();
	});

	it("normalises dedupe keys case-insensitively on Windows only", () => {
		const windowsKey = normalizeSystemWallpaperKey("C:\\Users\\Me\\Photo.JPG", "win32");
		const windowsKeyAgain = normalizeSystemWallpaperKey("c:\\users\\me\\photo.jpg", "win32");
		expect(windowsKey).toBe(windowsKeyAgain);

		const linuxKey = normalizeSystemWallpaperKey("/home/me/Photo.JPG", "linux");
		const linuxKeyAgain = normalizeSystemWallpaperKey("/home/me/photo.jpg", "linux");
		expect(linuxKey).not.toBe(linuxKeyAgain);
	});

	it("reads string and binary values out of reg.exe query output", () => {
		const output = [
			"",
			"HKEY_CURRENT_USER\\Control Panel\\Desktop",
			"    Wallpaper    REG_SZ    C:\\Users\\Me\\Pictures\\wallpaper.jpg",
			"    WallpaperStyle    REG_SZ    10",
			"    TranscodedImageCache    REG_BINARY    7AC3",
			"",
		].join("\r\n");

		expect(extractRegistryString(output, "Wallpaper")).toBe(
			"C:\\Users\\Me\\Pictures\\wallpaper.jpg",
		);
		// Must not be confused with the TranscodedImageCache binary value.
		expect(extractRegistryString(output, "TranscodedImageCache")).toBeNull();
		expect(extractRegistryBinary(output, "TranscodedImageCache")).toBe("7AC3");
		expect(extractRegistryBinary(output, "Wallpaper")).toBeNull();
		expect(extractRegistryString(output, "Missing")).toBeNull();
		expect(extractRegistryString("    Wallpaper    REG_SZ    ", "Wallpaper")).toBeNull();
	});

	it("decodes the original wallpaper path from the transcoded image cache", () => {
		const sourcePath = "c:\\windows\\web\\wallpaper\\windows\\img19.jpg";

		expect(parseTranscodedImageCachePath(buildTranscodedImageCacheHex(sourcePath))).toBe(
			sourcePath,
		);
		expect(parseTranscodedImageCachePath(null)).toBeNull();
		expect(parseTranscodedImageCachePath("")).toBeNull();
		// Odd-length and non-hex payloads must not throw.
		expect(parseTranscodedImageCachePath("abc")).toBeNull();
		expect(parseTranscodedImageCachePath("zzzz")).toBeNull();
		expect(parseTranscodedImageCachePath("00112233")).toBeNull();
	});
});

describe("collectSystemWallpaperImages", () => {
	let root: string;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-system-wallpapers-"));
	});

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	async function writeFile(relativePath: string, size = 32): Promise<string> {
		const targetPath = path.join(root, relativePath);
		await fs.mkdir(path.dirname(targetPath), { recursive: true });
		await fs.writeFile(targetPath, Buffer.alloc(size, 1));
		return targetPath;
	}

	it("returns only usable images and names them", async () => {
		await writeFile("gallery/one.jpg");
		await writeFile("gallery/notes.txt");
		await writeFile("gallery/too-big.png", 4096);

		const { images, truncated } = await collectSystemWallpaperImages({
			roots: [{ dir: path.join(root, "gallery"), source: "pictures" }],
			maxFileBytes: 1024,
		});

		expect(images.map((image) => image.name)).toEqual(["One"]);
		expect(images[0]?.source).toBe("pictures");
		expect(truncated).toBe(false);
	});

	it("dedupes the same file reached through several roots", async () => {
		const targetPath = await writeFile("gallery/one.jpg");

		const { images } = await collectSystemWallpaperImages({
			roots: [
				{ dir: path.join(root, "gallery"), source: "themes" },
				{ dir: path.join(root, "gallery"), source: "pictures" },
			],
		});

		expect(images).toHaveLength(1);
		expect(images[0]?.path).toBe(await fs.realpath(targetPath));
		expect(images[0]?.source).toBe("themes");
	});

	it("caps the number of results and reports truncation", async () => {
		await writeFile("gallery/a.jpg");
		await writeFile("gallery/b.jpg");
		await writeFile("gallery/c.jpg");

		const { images, truncated } = await collectSystemWallpaperImages({
			roots: [{ dir: path.join(root, "gallery"), source: "system" }],
			maxResults: 2,
		});

		expect(images).toHaveLength(2);
		expect(truncated).toBe(true);
	});

	it("stops recursing past the depth limit", async () => {
		await writeFile("gallery/one.jpg");
		await writeFile("gallery/nested/two.jpg");

		const { images } = await collectSystemWallpaperImages({
			roots: [{ dir: path.join(root, "gallery"), source: "system", maxDepth: 0 }],
		});

		expect(images.map((image) => image.name)).toEqual(["One"]);
	});

	it("stops walking once the visited-file budget is spent", async () => {
		await writeFile("gallery/a.jpg");
		await writeFile("gallery/b.jpg");
		await writeFile("gallery/c.jpg");

		const { images, truncated } = await collectSystemWallpaperImages({
			roots: [{ dir: path.join(root, "gallery"), source: "system" }],
			maxVisitedFiles: 1,
		});

		expect(images).toHaveLength(1);
		expect(truncated).toBe(true);
	});

	it("skips extensionless theme caches but keeps cached images", async () => {
		await writeFile("themes/TranscodedWallpaper");
		await writeFile("themes/CachedFiles/CachedImage_1920_1080_4.jpg");

		const { images } = await collectSystemWallpaperImages({
			roots: [{ dir: path.join(root, "themes"), source: "themes" }],
		});

		expect(images.map((image) => image.name)).toEqual(["1920 1080 4"]);
	});

	it("never throws for missing or unreadable roots", async () => {
		const result = await collectSystemWallpaperImages({
			roots: [
				{ dir: path.join(root, "missing"), source: "system" },
				{ dir: path.join(root, "gallery"), source: "pictures" },
			],
		});

		expect(result.images).toEqual([]);
		expect(result.truncated).toBe(false);
	});

	it("builds a single entry for a browsed file and rejects unusable ones", async () => {
		const imagePath = await writeFile("browse/photo.webp");
		const textPath = await writeFile("browse/notes.txt");

		await expect(createSystemWallpaperImage(imagePath, "browse")).resolves.toEqual({
			path: await fs.realpath(imagePath),
			name: "Photo",
			source: "browse",
		});
		await expect(createSystemWallpaperImage(textPath, "browse")).resolves.toBeNull();
		await expect(
			createSystemWallpaperImage(path.join(root, "browse", "missing.jpg"), "browse"),
		).resolves.toBeNull();
	});
});
