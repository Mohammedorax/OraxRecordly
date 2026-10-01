import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DesktopCapturerSource } from "electron";
import { clipboard, desktopCapturer, nativeImage } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type DisplayStub = {
	id: number;
	size: { width: number; height: number };
	scaleFactor: number;
	bounds: { x: number; y: number; width: number; height: number };
	workArea: { x: number; y: number; width: number; height: number };
};

type CropRect = { x: number; y: number; width: number; height: number };

const mocks = vi.hoisted(() => ({
	beginHudCaptureProtectionForScreenshot: vi.fn(),
	restoreHudCaptureProtection: vi.fn(),
	selectRegionOnDisplay: vi.fn(),
	openImageEditorWindow: vi.fn(),
	crop: vi.fn(),
	readScreenshotPreferences: vi.fn(),
	recordingsDir: "",
	displays: [] as unknown[],
	primaryDisplayId: 1,
	cursorPoint: { x: 0, y: 0 } as { x: number; y: number },
}));

vi.mock("electron", () => ({
	app: {
		// `electron/ipc/constants.ts` -> `electron/appPaths.ts` reads userData at
		// import time; the tests never touch that path.
		getPath: () => os.tmpdir(),
		setPath: () => undefined,
	},
	desktopCapturer: {
		getSources: vi.fn(),
	},
	ipcMain: {
		handle: vi.fn(),
	},
	clipboard: {
		writeImage: vi.fn(),
	},
	nativeImage: {
		createFromBuffer: vi.fn(),
	},
	dialog: {
		showSaveDialog: vi.fn(),
	},
}));

vi.mock("../../windows", () => ({
	beginHudCaptureProtectionForScreenshot: mocks.beginHudCaptureProtectionForScreenshot,
}));

vi.mock("../../screenshotWindows", () => ({
	selectRegionOnDisplay: mocks.selectRegionOnDisplay,
	openImageEditorWindow: mocks.openImageEditorWindow,
}));

vi.mock("../settings/screenshotPreferencesStore", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../settings/screenshotPreferencesStore")>();
	return {
		...actual,
		readScreenshotPreferences: mocks.readScreenshotPreferences,
	};
});

vi.mock("../utils", () => ({
	getRecordingsDir: async () => mocks.recordingsDir,
	getScreen: () => ({
		getAllDisplays: () => mocks.displays as DisplayStub[],
		getPrimaryDisplay: () =>
			(mocks.displays as DisplayStub[]).find(
				(display) => display.id === mocks.primaryDisplayId,
			) ?? (mocks.displays as DisplayStub[])[0],
		getCursorScreenPoint: () => mocks.cursorPoint,
	}),
}));

import { setSelectedSource } from "../state";
import {
	buildScreenshotFileName,
	captureScreenshot,
	captureScreenshotFullScreen,
	captureScreenshotRegion,
	openImageEditor,
	readImageFileAsDataUrl,
	resolveJpegQuality,
	resolveScreenshotDisplay,
	toPhysicalCropRect,
	writeImageFile,
} from "./screenshot";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CROPPED_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0b]);
const tempDirs: string[] = [];

function makeDisplay(
	id: number,
	width: number,
	height: number,
	scaleFactor: number,
	x = 0,
	y = 0,
): DisplayStub {
	return {
		id,
		size: { width, height },
		scaleFactor,
		bounds: { x, y, width, height },
		workArea: { x, y, width, height },
	};
}

/** Builds a fake NativeImage; `crop()` returns a smaller fake image of the crop size. */
function makeFakeImage(width: number, height: number, png: Uint8Array = PNG_BYTES) {
	const image = {
		getSize: () => ({ width, height }),
		toPNG: () => png,
		toJPEG: () => png,
		isEmpty: () => width * height === 0,
		resize: ({ width: w, height: h }: { width: number; height: number }) =>
			makeFakeImage(w ?? width, h ?? height, png),
		crop: (rect: CropRect) => {
			mocks.crop(rect);
			return makeFakeImage(rect.width, rect.height, CROPPED_BYTES);
		},
	};
	return image;
}

function makeSource({
	id,
	displayId,
	width,
	height,
	png = PNG_BYTES,
}: {
	id: string;
	displayId: string;
	width: number;
	height: number;
	png?: Uint8Array;
}): DesktopCapturerSource {
	return {
		id,
		name: id,
		display_id: displayId,
		thumbnail: makeFakeImage(width, height, png),
	} as unknown as DesktopCapturerSource;
}

async function readScreenshotFiles() {
	const screenshotsDir = path.join(mocks.recordingsDir, "Screenshots");
	try {
		return await fs.readdir(screenshotsDir);
	} catch {
		return [];
	}
}

beforeEach(async () => {
	mocks.recordingsDir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-screenshot-"));
	tempDirs.push(mocks.recordingsDir);
	mocks.displays = [makeDisplay(1, 1280, 720, 2)];
	mocks.primaryDisplayId = 1;
	mocks.cursorPoint = { x: 0, y: 0 };
	mocks.beginHudCaptureProtectionForScreenshot
		.mockReset()
		.mockReturnValue(mocks.restoreHudCaptureProtection);
	mocks.restoreHudCaptureProtection.mockReset();
	mocks.selectRegionOnDisplay.mockReset();
	mocks.openImageEditorWindow.mockReset();
	mocks.crop.mockReset();
	mocks.readScreenshotPreferences.mockReset().mockResolvedValue({
		format: "png",
		jpegQuality: 92,
		openEditorAfterCapture: false,
		globalShortcut: "CommandOrControl+Shift+S",
		copyToClipboard: false,
	});
	vi.mocked(clipboard.writeImage).mockReset();
	vi.mocked(desktopCapturer.getSources).mockReset();
	setSelectedSource(null);
});

afterEach(async () => {
	vi.restoreAllMocks();
	setSelectedSource(null);
	await Promise.allSettled(
		tempDirs.splice(0).map((dir) => fs.rm(dir, { force: true, recursive: true })),
	);
});

describe("captureScreenshot (selected source)", () => {
	it("writes a full-resolution PNG for the selected source and reports its real size", async () => {
		setSelectedSource({
			id: "screen:1",
			name: "Screen 1",
			display_id: "1",
			sourceType: "screen",
		});
		vi.mocked(desktopCapturer.getSources).mockResolvedValue([
			makeSource({ id: "screen:1", displayId: "1", width: 2560, height: 1440 }),
		]);

		const result = await captureScreenshot();

		expect(result.success).toBe(true);
		expect(result.width).toBe(2560);
		expect(result.height).toBe(1440);
		expect(result.error).toBeUndefined();
		expect(result.path).toBeTruthy();

		const screenshotPath = result.path as string;
		expect(path.dirname(screenshotPath)).toBe(path.join(mocks.recordingsDir, "Screenshots"));
		// Default template: `Screenshot <YYYY-MM-DD> <HH-MM-SS>.png`.
		expect(path.basename(screenshotPath)).toMatch(
			/^Screenshot \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}( \(\d+\))?\.png$/,
		);
		await expect(fs.readFile(screenshotPath)).resolves.toEqual(PNG_BYTES);

		// The native request must use the target display's physical pixels.
		expect(desktopCapturer.getSources).toHaveBeenCalledWith({
			types: ["screen", "window"],
			thumbnailSize: { width: 2560, height: 1440 },
			fetchWindowIcons: false,
		});
		expect(mocks.beginHudCaptureProtectionForScreenshot).toHaveBeenCalledTimes(1);
		expect(mocks.restoreHudCaptureProtection).toHaveBeenCalledTimes(1);
	});

	it("matches a synthetic screen source id by its remembered display", async () => {
		setSelectedSource({
			id: "screen:fallback:1",
			name: "Screen 1 (Primary)",
			display_id: "1",
			sourceType: "screen",
		});
		vi.mocked(desktopCapturer.getSources).mockResolvedValue([
			makeSource({ id: "screen:0:0", displayId: "1", width: 2560, height: 1440 }),
		]);

		const result = await captureScreenshot();

		expect(result.success).toBe(true);
		expect(result.fallback).toBeUndefined();
		expect(result.width).toBe(2560);
	});

	it("captures the primary display and reports the fallback when the stored source is gone", async () => {
		setSelectedSource({
			id: "window:4242",
			name: "Gone Window",
			display_id: "1",
			sourceType: "window",
		});
		vi.mocked(desktopCapturer.getSources).mockResolvedValue([
			makeSource({ id: "screen:1", displayId: "1", width: 2560, height: 1440 }),
		]);

		const result = await captureScreenshot();

		expect(result.success).toBe(true);
		expect(result.fallback).toBe(true);
		expect(result.message).toMatch(/primary display/i);
		expect(result.width).toBe(2560);
		expect(result.height).toBe(1440);
	});

	it("fails without writing a file when the thumbnail image is empty", async () => {
		setSelectedSource({
			id: "screen:1",
			name: "Screen 1",
			display_id: "1",
			sourceType: "screen",
		});
		vi.mocked(desktopCapturer.getSources).mockResolvedValue([
			makeSource({
				id: "screen:1",
				displayId: "1",
				width: 0,
				height: 0,
				png: Buffer.alloc(0),
			}),
		]);

		const result = await captureScreenshot();

		expect(result.success).toBe(false);
		expect(result.path).toBeUndefined();
		expect(result.error).toMatch(/empty image/i);
		await expect(fs.readdir(path.join(mocks.recordingsDir, "Screenshots"))).rejects.toThrow();
	});

	it("fails when the thumbnail encodes no PNG bytes", async () => {
		setSelectedSource({
			id: "screen:1",
			name: "Screen 1",
			display_id: "1",
			sourceType: "screen",
		});
		vi.mocked(desktopCapturer.getSources).mockResolvedValue([
			makeSource({
				id: "screen:1",
				displayId: "1",
				width: 2560,
				height: 1440,
				png: Buffer.alloc(0),
			}),
		]);

		const result = await captureScreenshot();

		expect(result.success).toBe(false);
		expect(result.path).toBeUndefined();
		expect(result.error).toMatch(/empty PNG/i);
	});

	it("restores HUD content protection when the capture throws", async () => {
		setSelectedSource({
			id: "screen:1",
			name: "Screen 1",
			display_id: "1",
			sourceType: "screen",
		});
		vi.mocked(desktopCapturer.getSources).mockRejectedValue(new Error("capture exploded"));

		const result = await captureScreenshot();

		expect(result).toEqual({ success: false, error: "capture exploded" });
		expect(mocks.beginHudCaptureProtectionForScreenshot).toHaveBeenCalledTimes(1);
		expect(mocks.restoreHudCaptureProtection).toHaveBeenCalledTimes(1);
	});
});

describe("captureScreenshotFullScreen", () => {
	it("captures the cursor display at native pixels and saves a PNG without a selected source", async () => {
		setSelectedSource(null);
		vi.mocked(desktopCapturer.getSources).mockResolvedValue([
			makeSource({ id: "screen:1", displayId: "1", width: 2560, height: 1440 }),
		]);

		const result = await captureScreenshotFullScreen();

		expect(result.success).toBe(true);
		expect(result.width).toBe(2560);
		expect(result.height).toBe(1440);
		expect(result.canceled).toBeUndefined();

		// Screen-only enumeration, requested at the display's physical pixels.
		expect(desktopCapturer.getSources).toHaveBeenCalledWith({
			types: ["screen"],
			thumbnailSize: { width: 2560, height: 1440 },
			fetchWindowIcons: false,
		});

		const screenshotPath = result.path as string;
		await expect(fs.readFile(screenshotPath)).resolves.toEqual(PNG_BYTES);
		expect(mocks.beginHudCaptureProtectionForScreenshot).toHaveBeenCalledTimes(1);
		expect(mocks.restoreHudCaptureProtection).toHaveBeenCalledTimes(1);
	});

	it("captures the requested display when options.displayId is given", async () => {
		mocks.displays = [makeDisplay(1, 1280, 720, 2), makeDisplay(2, 1920, 1080, 1, 1280, 0)];
		mocks.cursorPoint = { x: 0, y: 0 };
		vi.mocked(desktopCapturer.getSources).mockResolvedValue([
			makeSource({ id: "screen:1", displayId: "1", width: 2560, height: 1440 }),
			makeSource({ id: "screen:2", displayId: "2", width: 1920, height: 1080 }),
		]);

		const result = await captureScreenshotFullScreen({ displayId: "2" });

		expect(result.success).toBe(true);
		expect(result.width).toBe(1920);
		expect(result.height).toBe(1080);
		expect(desktopCapturer.getSources).toHaveBeenCalledWith({
			types: ["screen"],
			thumbnailSize: { width: 1920, height: 1080 },
			fetchWindowIcons: false,
		});
	});

	it("captures the cursor's display when several displays are connected", async () => {
		mocks.displays = [makeDisplay(1, 1280, 720, 2), makeDisplay(2, 1920, 1080, 1, 1280, 0)];
		mocks.cursorPoint = { x: 2000, y: 200 };
		vi.mocked(desktopCapturer.getSources).mockResolvedValue([
			makeSource({ id: "screen:1", displayId: "1", width: 2560, height: 1440 }),
			makeSource({ id: "screen:2", displayId: "2", width: 1920, height: 1080 }),
		]);

		const result = await captureScreenshotFullScreen();

		expect(result.width).toBe(1920);
		expect(result.height).toBe(1080);
	});

	it("fails without writing a file when no screen source matches the display", async () => {
		vi.mocked(desktopCapturer.getSources).mockResolvedValue([]);

		const result = await captureScreenshotFullScreen();

		expect(result.success).toBe(false);
		expect(result.path).toBeUndefined();
		expect(result.error).toMatch(/no capturable screen source/i);
		await expect(readScreenshotFiles()).resolves.toEqual([]);
	});

	it("writes a JPEG when the stored format preference is jpeg", async () => {
		mocks.readScreenshotPreferences.mockResolvedValue({
			format: "jpeg",
			jpegQuality: 80,
			openEditorAfterCapture: false,
			globalShortcut: null,
			copyToClipboard: false,
		});
		vi.mocked(desktopCapturer.getSources).mockResolvedValue([
			makeSource({ id: "screen:1", displayId: "1", width: 2560, height: 1440 }),
		]);

		const result = await captureScreenshotFullScreen();

		expect(result.success).toBe(true);
		expect(path.extname(result.path as string)).toBe(".jpg");
		await expect(fs.readFile(result.path as string)).resolves.toEqual(PNG_BYTES);
	});

	it("copies to the clipboard and opens the editor when the preferences ask for it", async () => {
		mocks.readScreenshotPreferences.mockResolvedValue({
			format: "png",
			jpegQuality: 92,
			openEditorAfterCapture: true,
			globalShortcut: "CommandOrControl+Shift+S",
			copyToClipboard: true,
		});
		vi.mocked(desktopCapturer.getSources).mockResolvedValue([
			makeSource({ id: "screen:1", displayId: "1", width: 2560, height: 1440 }),
		]);

		const result = await captureScreenshotFullScreen();

		expect(result.success).toBe(true);
		expect(clipboard.writeImage).toHaveBeenCalledTimes(1);
		expect(mocks.openImageEditorWindow).toHaveBeenCalledWith(result.path);
	});
});

describe("screenshot file name template and folder wiring", () => {
	const basePreferences = {
		format: "png" as const,
		jpegQuality: 92,
		openEditorAfterCapture: false,
		globalShortcut: null,
		copyToClipboard: false,
		captureDelayMs: 0 as const,
		lastCaptureMode: null,
		fileNameTemplate: "Screenshot {date} {time}",
		folder: null,
	};

	beforeEach(() => {
		vi.mocked(desktopCapturer.getSources).mockResolvedValue([
			makeSource({ id: "screen:1", displayId: "1", width: 2560, height: 1440 }),
		]);
	});

	it("renders the stored template and substitutes {app} with the source name", async () => {
		mocks.readScreenshotPreferences.mockResolvedValue({
			...basePreferences,
			fileNameTemplate: "{app} {date}",
		});

		const result = await captureScreenshotFullScreen();

		expect(result.success).toBe(true);
		// `screen:1` is the stubbed source name; the colon is sanitized to a space.
		expect(path.basename(result.path as string)).toMatch(
			/^screen 1 \d{4}-\d{2}-\d{2}( \(\d+\))?\.png$/,
		);
	});

	it("writes into a usable custom folder", async () => {
		const customDir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-custom-shots-"));
		tempDirs.push(customDir);
		mocks.readScreenshotPreferences.mockResolvedValue({
			...basePreferences,
			folder: customDir,
		});

		const result = await captureScreenshotFullScreen();

		expect(result.success).toBe(true);
		expect(result.folderFallback).toBeUndefined();
		expect(path.dirname(result.path as string)).toBe(customDir);
		await expect(fs.readFile(result.path as string)).resolves.toEqual(PNG_BYTES);
	});

	it("falls back to the default folder and reports an unusable custom folder", async () => {
		mocks.readScreenshotPreferences.mockResolvedValue({
			...basePreferences,
			folder: "relative/shots",
		});

		const result = await captureScreenshotFullScreen();

		expect(result.success).toBe(true);
		expect(result.folderFallback).toBe(true);
		expect(result.message).toMatch(/unusable/i);
		expect(path.dirname(result.path as string)).toBe(
			path.join(mocks.recordingsDir, "Screenshots"),
		);
	});

	it("never overwrites an existing capture; the second one gets a (2) suffix", async () => {
		mocks.readScreenshotPreferences.mockResolvedValue({
			...basePreferences,
			fileNameTemplate: "shot",
		});

		const first = await captureScreenshotFullScreen();
		const second = await captureScreenshotFullScreen();

		expect(first.success).toBe(true);
		expect(second.success).toBe(true);
		expect(first.path).not.toBe(second.path);
		expect(path.basename(first.path as string)).toBe("shot.png");
		expect(path.basename(second.path as string)).toBe("shot (2).png");
		await expect(fs.readFile(first.path as string)).resolves.toEqual(PNG_BYTES);
		await expect(fs.readFile(second.path as string)).resolves.toEqual(PNG_BYTES);
	});
});

describe("captureScreenshotRegion", () => {
	beforeEach(() => {
		vi.mocked(desktopCapturer.getSources).mockResolvedValue([
			makeSource({ id: "screen:1", displayId: "1", width: 2560, height: 1440 }),
		]);
	});

	it("crops the captured display to the selection in physical pixels", async () => {
		mocks.selectRegionOnDisplay.mockResolvedValue({
			x: 100,
			y: 50,
			width: 300,
			height: 200,
		});

		const result = await captureScreenshotRegion();

		expect(result.success).toBe(true);
		// DIP rect * scaleFactor (2) => physical crop rect.
		expect(mocks.crop).toHaveBeenCalledWith({ x: 200, y: 100, width: 600, height: 400 });
		// The returned size is the cropped size, not the full display size.
		expect(result.width).toBe(600);
		expect(result.height).toBe(400);
		expect(result.path).toBeTruthy();
		await expect(fs.readFile(result.path as string)).resolves.toEqual(CROPPED_BYTES);
		await expect(readScreenshotFiles()).resolves.toHaveLength(1);
		expect(mocks.selectRegionOnDisplay).toHaveBeenCalledTimes(1);
	});

	it("clamps a selection that starts before the display edge to the origin", async () => {
		mocks.selectRegionOnDisplay.mockResolvedValue({
			x: -40,
			y: -20,
			width: 1400,
			height: 900,
		});

		const result = await captureScreenshotRegion();

		expect(result.success).toBe(true);
		expect(mocks.crop).toHaveBeenCalledWith({ x: 0, y: 0, width: 2560, height: 1440 });
		expect(result.width).toBe(2560);
		expect(result.height).toBe(1440);
	});

	it("clamps a selection that starts past the display edge to the image edge", async () => {
		mocks.selectRegionOnDisplay.mockResolvedValue({
			x: 1200,
			y: 0,
			width: 300,
			height: 200,
		});

		const result = await captureScreenshotRegion();

		expect(result.success).toBe(true);
		// 1200 DIP * 2 = 2400px; the overshoot is clipped at the 2560px image edge.
		expect(mocks.crop).toHaveBeenCalledWith({
			x: 2400,
			y: 0,
			width: 160,
			height: 400,
		});
		expect(result.width).toBe(160);
		expect(result.height).toBe(400);
	});

	it("resolves canceled without writing a file when the user presses Esc", async () => {
		mocks.selectRegionOnDisplay.mockResolvedValue(null);

		const result = await captureScreenshotRegion();

		expect(result).toEqual({ success: false, canceled: true });
		expect(result.path).toBeUndefined();
		await expect(readScreenshotFiles()).resolves.toEqual([]);
		expect(mocks.crop).not.toHaveBeenCalled();
		// The HUD content-protection override is always restored.
		expect(mocks.restoreHudCaptureProtection).toHaveBeenCalledTimes(1);
	});

	it("fails without writing a file when the region capture has no screen source", async () => {
		vi.mocked(desktopCapturer.getSources).mockResolvedValue([]);
		mocks.selectRegionOnDisplay.mockResolvedValue({ x: 0, y: 0, width: 10, height: 10 });

		const result = await captureScreenshotRegion();

		expect(result.success).toBe(false);
		expect(result.canceled).toBeUndefined();
		await expect(readScreenshotFiles()).resolves.toEqual([]);
	});

	it("opens the image editor for the cropped file when the preference is on", async () => {
		mocks.readScreenshotPreferences.mockResolvedValue({
			format: "png",
			jpegQuality: 92,
			openEditorAfterCapture: true,
			globalShortcut: "CommandOrControl+Shift+S",
			copyToClipboard: false,
		});
		mocks.selectRegionOnDisplay.mockResolvedValue({ x: 10, y: 10, width: 100, height: 100 });

		const result = await captureScreenshotRegion();

		expect(result.success).toBe(true);
		expect(mocks.openImageEditorWindow).toHaveBeenCalledWith(result.path);
	});
});

describe("resolveScreenshotDisplay", () => {
	const primary = makeDisplay(1, 1280, 720, 2) as never;
	const secondary = makeDisplay(2, 1920, 1080, 1, 1280, 0) as never;

	it("prefers an explicit display id over the cursor", () => {
		const display = resolveScreenshotDisplay("1", [primary, secondary], primary, {
			x: 2000,
			y: 200,
		} as Electron.Point);
		expect(display).toBe(primary);
	});

	it("falls back to the cursor's display for an unknown display id", () => {
		const display = resolveScreenshotDisplay("999", [primary, secondary], primary, {
			x: 2000,
			y: 200,
		} as Electron.Point);
		expect(display).toBe(secondary);
	});

	it("falls back to the primary display when the cursor matches no display", () => {
		const display = resolveScreenshotDisplay(undefined, [primary, secondary], primary, {
			x: -5000,
			y: -5000,
		} as Electron.Point);
		expect(display).toBe(primary);
	});
});

describe("toPhysicalCropRect", () => {
	it("scales a DIP rect by the display scale factor", () => {
		expect(
			toPhysicalCropRect({ x: 10, y: 20, width: 100, height: 50 }, 2, {
				width: 2560,
				height: 1440,
			}),
		).toEqual({ x: 20, y: 40, width: 200, height: 100 });
	});

	it("clamps negative origins and overflow to the captured image", () => {
		expect(
			toPhysicalCropRect({ x: -10, y: -10, width: 5000, height: 5000 }, 1, {
				width: 1920,
				height: 1080,
			}),
		).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
	});

	it("never returns a zero-sized crop for a rect starting outside the image", () => {
		expect(
			toPhysicalCropRect({ x: 5000, y: 5000, width: 100, height: 100 }, 1, {
				width: 1920,
				height: 1080,
			}),
		).toEqual({ x: 1919, y: 1079, width: 1, height: 1 });
	});

	it("treats an invalid scale factor as 1", () => {
		expect(
			toPhysicalCropRect({ x: 5, y: 5, width: 10, height: 10 }, Number.NaN, {
				width: 100,
				height: 100,
			}),
		).toEqual({ x: 5, y: 5, width: 10, height: 10 });
	});
});

describe("buildScreenshotFileName", () => {
	it("renders the default template as a filesystem-safe local-time name", () => {
		expect(buildScreenshotFileName(new Date(2026, 9, 1, 13, 47, 41, 7))).toBe(
			"Screenshot 2026-10-01 13-47-41.png",
		);
	});

	it("still supports the pre-template default name for an empty template", () => {
		expect(buildScreenshotFileName(new Date(2026, 9, 1, 13, 47, 41, 7), "   ")).toBe(
			"screenshot-2026-10-01-13-47-41-007.png",
		);
	});
});

describe("resolveJpegQuality", () => {
	it("accepts both 0-1 ratios and 1-100 percentages", () => {
		expect(resolveJpegQuality(0.92)).toBe(92);
		expect(resolveJpegQuality(1)).toBe(100);
		expect(resolveJpegQuality(80)).toBe(80);
		expect(resolveJpegQuality(150)).toBe(100);
		expect(resolveJpegQuality(0)).toBe(1);
		expect(resolveJpegQuality(undefined)).toBe(92);
	});
});

describe("image editor IPC", () => {
	it("reads an existing image file as a data URL", async () => {
		const imagePath = path.join(mocks.recordingsDir, "Screenshots", "shot.png");
		await fs.mkdir(path.dirname(imagePath), { recursive: true });
		await fs.writeFile(imagePath, PNG_BYTES);

		const result = await readImageFileAsDataUrl(imagePath);

		expect(result.success).toBe(true);
		expect(result.dataUrl).toBe(`data:image/png;base64,${PNG_BYTES.toString("base64")}`);
	});

	it("reports a failure for a missing image file", async () => {
		const result = await readImageFileAsDataUrl(path.join(mocks.recordingsDir, "missing.png"));

		expect(result.success).toBe(false);
		expect(result.dataUrl).toBeUndefined();
		expect(result.error).toBeTruthy();
	});

	it("writes an edited PNG back to disk without a save dialog", async () => {
		const image = makeFakeImage(4, 4);
		vi.mocked(nativeImage.createFromBuffer).mockReturnValue(image as never);
		const target = path.join(mocks.recordingsDir, "edited.png");

		const result = await writeImageFile(
			target,
			`data:image/png;base64,${PNG_BYTES.toString("base64")}`,
			{ format: "png" },
		);

		expect(result.success).toBe(true);
		expect(result.path).toBe(target);
		await expect(fs.readFile(target)).resolves.toEqual(PNG_BYTES);
	});

	it("rejects a data URL that is not a base64 image", async () => {
		const result = await writeImageFile(
			path.join(mocks.recordingsDir, "edited.png"),
			"https://example.com/image.png",
		);

		expect(result.success).toBe(false);
		expect(result.error).toMatch(/data URL/i);
	});

	it("refuses to open the editor for a file that does not exist", async () => {
		const result = await openImageEditor(path.join(mocks.recordingsDir, "nope.png"));

		expect(result.success).toBe(false);
		expect(result.error).toMatch(/not found/i);
		expect(mocks.openImageEditorWindow).not.toHaveBeenCalled();
	});

	it("opens the editor window for an existing image", async () => {
		const imagePath = path.join(mocks.recordingsDir, "existing.png");
		await fs.writeFile(imagePath, PNG_BYTES);

		const result = await openImageEditor(imagePath);

		expect(result).toEqual({ success: true });
		expect(mocks.openImageEditorWindow).toHaveBeenCalledWith(imagePath);
	});
});
