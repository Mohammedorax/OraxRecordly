import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		// `electron/ipc/constants.ts` -> `electron/appPaths.ts` reads userData at
		// import time; these tests always pass an explicit file path instead.
		getPath: () => os.tmpdir(),
		setPath: () => undefined,
	},
}));

import {
	buildLegacyScreenshotFileName,
	buildScreenshotFileName,
	SCREENSHOT_FILE_NAME_TEMPLATE_MAX_LENGTH,
	sanitizeScreenshotFileName,
	withUniqueScreenshotFileName,
} from "../../../src/utils/screenshotFileName";
import {
	clampCaptureDelayMs,
	clampJpegQuality,
	clampScreenshotFileNameTemplate,
	createScreenshotPreferencesStore,
	DEFAULT_SCREENSHOT_PREFERENCES,
	normalizeScreenshotFolder,
	normalizeScreenshotPreferences,
	SCREENSHOT_DEFAULT_SHORTCUT,
} from "./screenshotPreferencesStore";

const tempDirs: string[] = [];
let settingsFile = "";

async function makeStore() {
	return createScreenshotPreferencesStore(settingsFile);
}

async function readRaw() {
	return JSON.parse(await fs.readFile(settingsFile, "utf-8")) as Record<string, unknown>;
}

beforeEach(async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-screenshot-prefs-"));
	tempDirs.push(dir);
	settingsFile = path.join(dir, "screenshot-settings.json");
});

afterEach(async () => {
	await Promise.allSettled(
		tempDirs.splice(0).map((dir) => fs.rm(dir, { force: true, recursive: true })),
	);
});

describe("screenshot preferences defaults", () => {
	it("returns the documented defaults when no settings file exists", async () => {
		const store = await makeStore();
		const preferences = await store.read();

		expect(preferences).toEqual({
			format: "png",
			jpegQuality: 92,
			openEditorAfterCapture: true,
			globalShortcut: "CommandOrControl+Alt+A",
			copyToClipboard: false,
			captureDelayMs: 0,
			lastCaptureMode: null,
			fileNameTemplate: "Screenshot {date} {time}",
			folder: null,
		});
		expect(preferences).toEqual(DEFAULT_SCREENSHOT_PREFERENCES);
	});

	it("keeps the default screenshot formatter lossless (png)", () => {
		expect(DEFAULT_SCREENSHOT_PREFERENCES.format).toBe("png");
		expect(SCREENSHOT_DEFAULT_SHORTCUT).toBe("CommandOrControl+Alt+A");
	});

	it("round-trips a written patch and persists it to disk", async () => {
		const store = await makeStore();
		await store.update({
			format: "jpeg",
			jpegQuality: 55,
			openEditorAfterCapture: false,
			globalShortcut: "CommandOrControl+Alt+4",
			copyToClipboard: true,
			captureDelayMs: 3000,
			lastCaptureMode: "region",
			fileNameTemplate: "{app} {datetime}",
			folder: "C:\\Captures",
		});

		const reloaded = await (await makeStore()).read();

		expect(reloaded).toEqual({
			format: "jpeg",
			jpegQuality: 55,
			openEditorAfterCapture: false,
			globalShortcut: "CommandOrControl+Alt+4",
			copyToClipboard: true,
			captureDelayMs: 3000,
			lastCaptureMode: "region",
			fileNameTemplate: "{app} {datetime}",
			folder: "C:\\Captures",
		});
		// A fresh store instance reads the same file, so the value really persisted.
		await expect(readRaw()).resolves.toMatchObject({ format: "jpeg", jpegQuality: 55 });
	});

	it("merges a partial patch instead of dropping the other preferences", async () => {
		const store = await makeStore();
		await store.update({ copyToClipboard: true });
		await store.update({ jpegQuality: 10 });

		await expect(store.read()).resolves.toEqual({
			format: "png",
			jpegQuality: 10,
			openEditorAfterCapture: true,
			globalShortcut: "CommandOrControl+Alt+A",
			copyToClipboard: true,
			captureDelayMs: 0,
			lastCaptureMode: null,
			fileNameTemplate: "Screenshot {date} {time}",
			folder: null,
		});
	});

	it("remembers the last successful capture mode", async () => {
		const store = await makeStore();
		await store.update({ lastCaptureMode: "fullscreen" });
		await expect(store.read()).resolves.toMatchObject({ lastCaptureMode: "fullscreen" });

		await store.update({ lastCaptureMode: "source" });
		await expect(store.read()).resolves.toMatchObject({ lastCaptureMode: "source" });

		await store.update({ lastCaptureMode: null });
		await expect(store.read()).resolves.toMatchObject({ lastCaptureMode: null });
	});

	it("ignores an unknown capture mode instead of persisting it", async () => {
		const store = await makeStore();
		await store.update({ lastCaptureMode: "window" as never });
		await expect(store.read()).resolves.toMatchObject({ lastCaptureMode: null });
	});

	it("allows disabling the global shortcut with null", async () => {
		const store = await makeStore();
		const updated = await store.update({ globalShortcut: null });

		expect(updated.globalShortcut).toBeNull();
		await expect(store.read()).resolves.toMatchObject({ globalShortcut: null });
	});

	it("clamps jpeg quality into 1-100 and ignores unknown formats", async () => {
		const store = await makeStore();
		const updated = await store.update({
			jpegQuality: 1000,
			format: "bmp" as never,
		});

		expect(updated.jpegQuality).toBe(100);
		expect(updated.format).toBe("png");
	});

	it("normalizes unreadable values back to defaults", () => {
		const preferences = normalizeScreenshotPreferences({
			format: "gif",
			jpegQuality: "not-a-number",
			openEditorAfterCapture: "yes",
			globalShortcut: 42,
			copyToClipboard: "no",
			captureDelayMs: "soon",
			lastCaptureMode: "window",
		});

		expect(preferences).toEqual(DEFAULT_SCREENSHOT_PREFERENCES);
	});

	it("clamps out-of-range quality values deterministically", () => {
		expect(clampJpegQuality(0, 92)).toBe(1);
		expect(clampJpegQuality(-10, 92)).toBe(1);
		expect(clampJpegQuality(101, 92)).toBe(100);
		expect(clampJpegQuality(99.6, 92)).toBe(100);
		expect(clampJpegQuality(undefined, 92)).toBe(92);
	});

	it("snaps capture delays onto the offered presets", () => {
		expect(clampCaptureDelayMs(3000, 0)).toBe(3000);
		expect(clampCaptureDelayMs(5000, 0)).toBe(5000);
		expect(clampCaptureDelayMs(0, 5000)).toBe(0);
		expect(clampCaptureDelayMs(-500, 0)).toBe(0);
		expect(clampCaptureDelayMs(2000, 0)).toBe(3000);
		expect(clampCaptureDelayMs(999999, 0)).toBe(5000);
		expect(clampCaptureDelayMs(undefined, 0)).toBe(0);
	});

	it("clamps a stored capture delay in both directions", async () => {
		const store = await makeStore();
		await expect(store.update({ captureDelayMs: 4200 })).resolves.toMatchObject({
			captureDelayMs: 5000,
		});
		await expect(store.update({ captureDelayMs: 100 })).resolves.toMatchObject({
			captureDelayMs: 0,
		});
	});
});

describe("screenshot file name template", () => {
	const captureDate = new Date(2026, 9, 1, 13, 47, 41, 7);

	it("defaults to the documented template and round-trips a custom one", async () => {
		const store = await makeStore();
		const defaults = await store.read();

		expect(defaults.fileNameTemplate).toBe("Screenshot {date} {time}");
		expect(DEFAULT_SCREENSHOT_PREFERENCES.fileNameTemplate).toBe("Screenshot {date} {time}");

		await store.update({ fileNameTemplate: "{app} {datetime}" });
		await expect((await makeStore()).read()).resolves.toMatchObject({
			fileNameTemplate: "{app} {datetime}",
		});
	});

	it("clamps an empty, whitespace-only or non-string template back to the default", () => {
		expect(clampScreenshotFileNameTemplate("", "fallback")).toBe("fallback");
		expect(clampScreenshotFileNameTemplate("   ", "fallback")).toBe("fallback");
		expect(clampScreenshotFileNameTemplate(42, "fallback")).toBe("fallback");
		expect(clampScreenshotFileNameTemplate(undefined, "fallback")).toBe("fallback");
		expect(clampScreenshotFileNameTemplate("  {date}   {time}  ", "fallback")).toBe(
			"{date} {time}",
		);
		expect(clampScreenshotFileNameTemplate("x".repeat(500), "fallback")).toHaveLength(
			SCREENSHOT_FILE_NAME_TEMPLATE_MAX_LENGTH,
		);
	});

	it("substitutes every documented token", () => {
		expect(buildScreenshotFileName(captureDate, "{date}")).toBe("2026-10-01.png");
		expect(buildScreenshotFileName(captureDate, "{time}")).toBe("13-47-41.png");
		expect(buildScreenshotFileName(captureDate, "{datetime}")).toBe("2026-10-01-13-47-41.png");
		expect(buildScreenshotFileName(captureDate, "{counter}", { counter: 7 })).toBe("007.png");
		expect(buildScreenshotFileName(captureDate, "{app}", { appName: "Firefox" })).toBe(
			"Firefox.png",
		);
		expect(
			buildScreenshotFileName(captureDate, "Screenshot {date} {time}", { extension: "jpg" }),
		).toBe("Screenshot 2026-10-01 13-47-41.jpg");
		// Tokens are matched case-insensitively and unknown text is kept.
		expect(buildScreenshotFileName(captureDate, "{DATE} — {nope}")).toBe(
			"2026-10-01 — {nope}.png",
		);
	});

	it("strips illegal Windows characters and collapses whitespace", () => {
		expect(buildScreenshotFileName(captureDate, 'a<b>c:d"e|f?g*h')).toBe("a b c d e f g h.png");
		expect(sanitizeScreenshotFileName("  spaced   name  ", "fallback")).toBe("spaced name");
		expect(sanitizeScreenshotFileName("trailing...", "fallback")).toBe("trailing");
		expect(sanitizeScreenshotFileName(".hidden.", "fallback")).toBe("hidden");
		// Windows reserves device names regardless of extension.
		expect(sanitizeScreenshotFileName("CON", "fallback")).toBe("CON_");
		expect(sanitizeScreenshotFileName("com1", "fallback")).toBe("com1_");
		// A user-typed extension is not doubled.
		expect(buildScreenshotFileName(captureDate, "shot.png")).toBe("shot.png");
	});

	it("neutralizes path-traversal attempts", () => {
		expect(buildScreenshotFileName(captureDate, "..\\..\\Windows\\System32\\evil")).toBe(
			"Windows System32 evil.png",
		);
		expect(buildScreenshotFileName(captureDate, "../../etc/passwd")).toBe("etc passwd.png");
		expect(buildScreenshotFileName(captureDate, "{app}", { appName: "..\\..\\secret" })).toBe(
			"secret.png",
		);

		// A template that is only separators sanitizes to nothing and falls back.
		expect(buildScreenshotFileName(captureDate, "..\\..\\..")).toBe(
			buildLegacyScreenshotFileName(captureDate),
		);

		// The rendered name never contains a separator, so it cannot escape the folder.
		const rendered = buildScreenshotFileName(captureDate, "C:\\Windows/System32\\evil.exe");
		expect(rendered).toBe("C Windows System32 evil.exe.png");
		expect(rendered).not.toMatch(/[\\/]/);
	});

	it("falls back to the previous default name when the result is empty", () => {
		expect(buildScreenshotFileName(captureDate, "   ")).toBe(
			"screenshot-2026-10-01-13-47-41-007.png",
		);
		expect(buildScreenshotFileName(captureDate, "...")).toBe(
			"screenshot-2026-10-01-13-47-41-007.png",
		);
		expect(buildScreenshotFileName(captureDate, "{app}", { appName: null })).toBe(
			"screenshot-2026-10-01-13-47-41-007.png",
		);
		expect(buildLegacyScreenshotFileName(captureDate, "jpeg")).toBe(
			"screenshot-2026-10-01-13-47-41-007.jpg",
		);
	});

	it("appends a numeric suffix instead of overwriting an existing file", () => {
		expect(withUniqueScreenshotFileName("shot.png", [])).toBe("shot.png");
		expect(withUniqueScreenshotFileName("shot.png", ["other.png"])).toBe("shot.png");
		expect(withUniqueScreenshotFileName("shot.png", ["shot.png"])).toBe("shot (2).png");
		expect(withUniqueScreenshotFileName("shot.png", ["shot.png", "shot (2).png"])).toBe(
			"shot (3).png",
		);
		// Windows and macOS file systems are case-insensitive.
		expect(withUniqueScreenshotFileName("Shot.PNG", ["shot.png"])).toBe("Shot (2).PNG");
	});
});

describe("custom screenshots folder preference", () => {
	it("stores a trimmed custom folder and resets it to null", async () => {
		const store = await makeStore();

		await expect(store.update({ folder: "  C:\\Captures  " })).resolves.toMatchObject({
			folder: "C:\\Captures",
		});
		await expect((await makeStore()).read()).resolves.toMatchObject({
			folder: "C:\\Captures",
		});

		await expect(store.update({ folder: null })).resolves.toMatchObject({ folder: null });
		// An empty string is "no custom folder", not a folder named "".
		await expect(store.update({ folder: "   " })).resolves.toMatchObject({ folder: null });
	});

	it("ignores unreadable folder values", () => {
		expect(normalizeScreenshotFolder(42)).toBeNull();
		expect(normalizeScreenshotFolder("")).toBeNull();
		expect(normalizeScreenshotFolder(" /tmp/shots ")).toBe("/tmp/shots");
		expect(normalizeScreenshotPreferences({ folder: 42 }).folder).toBeNull();
	});
});
