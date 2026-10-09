import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SOURCE_WALLPAPER_PATH = "c:\\windows\\web\\wallpaper\\windows\\img19.jpg";

function buildTranscodedImageCacheHex(filePath: string): string {
	// Real dumps are a binary header followed by the source path as UTF-16LE.
	const header = Buffer.from([0x7a, 0xc3, 0x01, 0x00, 0x84, 0x1c, 0x15, 0x00]);
	const pathBytes = Buffer.from(`${filePath}\0\0`, "utf16le");
	return Buffer.concat([header, pathBytes]).toString("hex").toUpperCase();
}

const SYSTEM_WALLPAPER_REGISTRY_OUTPUT = [
	"",
	"HKEY_CURRENT_USER\\Control Panel\\Desktop",
	"    Wallpaper    REG_SZ    C:\\Users\\Me\\Pictures\\wallpaper.jpg",
	`    TranscodedImageCache    REG_BINARY    ${buildTranscodedImageCacheHex(SOURCE_WALLPAPER_PATH)}`,
	"",
	"",
].join("\r\n");

describe("Windows desktop wallpaper registry", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.doMock("electron", () => ({
			app: {
				isPackaged: false,
				getPath: (name: string) =>
					name === "appData"
						? "C:\\Users\\Me\\AppData\\Roaming"
						: "C:\\Users\\Me\\Pictures",
				setPath: () => undefined,
			},
			dialog: { showOpenDialog: vi.fn() },
			ipcMain: { handle: vi.fn() },
		}));
	});

	afterEach(() => {
		vi.resetModules();
		vi.doUnmock("electron");
		vi.doUnmock("node:child_process");
	});

	it("reads the Wallpaper value and the transcoded image cache in one query", async () => {
		const execFileMock = vi.fn(
			(
				_command: string,
				_args: string[],
				_options: unknown,
				callback: (error: unknown, result: unknown) => void,
			) => {
				callback(null, { stdout: SYSTEM_WALLPAPER_REGISTRY_OUTPUT, stderr: "" });
			},
		);
		vi.doMock("node:child_process", () => ({ execFile: execFileMock }));

		const { queryWindowsDesktopRegistry } = await import("./systemWallpapers");

		await expect(queryWindowsDesktopRegistry()).resolves.toEqual({
			wallpaper: "C:\\Users\\Me\\Pictures\\wallpaper.jpg",
			transcodedImageCache: buildTranscodedImageCacheHex(SOURCE_WALLPAPER_PATH),
		});
		expect(execFileMock).toHaveBeenCalledWith(
			"reg.exe",
			["query", "HKCU\\Control Panel\\Desktop"],
			expect.objectContaining({ windowsHide: true }),
			expect.any(Function),
		);
	});

	it("returns nulls when the registry query fails", async () => {
		const execFileMock = vi.fn(
			(
				_command: string,
				_args: string[],
				_options: unknown,
				callback: (error: unknown, result: unknown) => void,
			) => {
				callback(
					new Error("The system was unable to find the specified registry key"),
					null,
				);
			},
		);
		vi.doMock("node:child_process", () => ({ execFile: execFileMock }));

		const { queryWindowsDesktopRegistry } = await import("./systemWallpapers");

		await expect(queryWindowsDesktopRegistry()).resolves.toEqual({
			wallpaper: null,
			transcodedImageCache: null,
		});
	});

	it("ignores empty registry strings", async () => {
		const execFileMock = vi.fn(
			(
				_command: string,
				_args: string[],
				_options: unknown,
				callback: (error: unknown, result: unknown) => void,
			) => {
				callback(null, {
					stdout: [
						"HKEY_CURRENT_USER\\Control Panel\\Desktop",
						"    Wallpaper    REG_SZ    ",
						"",
					].join("\r\n"),
					stderr: "",
				});
			},
		);
		vi.doMock("node:child_process", () => ({ execFile: execFileMock }));

		const { queryWindowsDesktopRegistry } = await import("./systemWallpapers");

		await expect(queryWindowsDesktopRegistry()).resolves.toEqual({
			wallpaper: null,
			transcodedImageCache: null,
		});
	});

	it("exposes the expected platform-specific roots", async () => {
		vi.doMock("node:child_process", () => ({ execFile: vi.fn() }));

		const { buildSystemWallpaperRoots } = await import("./systemWallpapers");
		const roots = buildSystemWallpaperRoots();

		expect(roots.some((root) => root.source === "pictures")).toBe(true);
		if (process.platform === "win32") {
			expect(roots.some((root) => root.source === "themes")).toBe(true);
			expect(roots.some((root) => root.source === "system")).toBe(true);
		}
	});
});
