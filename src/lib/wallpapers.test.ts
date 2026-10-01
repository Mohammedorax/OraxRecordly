import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	BUILT_IN_WALLPAPERS,
	DEFAULT_WALLPAPER_PATH,
	DEFAULT_WALLPAPER_RELATIVE_PATH,
	getAvailableWallpapers,
	isDeviceImagePath,
	resolveAvailableWallpaperPath,
} from "./wallpapers";

describe("wallpapers", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("keeps the curated wallpaper list and default path aligned", () => {
		expect(DEFAULT_WALLPAPER_PATH).toBe("/wallpapers/tahoe-light.jpg");
		expect(DEFAULT_WALLPAPER_RELATIVE_PATH).toBe("wallpapers/tahoe-light.jpg");
		expect(BUILT_IN_WALLPAPERS.at(0)?.publicPath).toBe(DEFAULT_WALLPAPER_PATH);
		expect(BUILT_IN_WALLPAPERS.at(1)?.publicPath).toBe("/wallpapers/tahoe-dark.jpg");
		expect(BUILT_IN_WALLPAPERS).toHaveLength(25);
	});

	it("preserves the curated order when asset discovery returns extra files", async () => {
		vi.stubGlobal("window", {
			electronAPI: {
				listAssetDirectory: vi.fn(async () => ({
					success: true,
					files: [
						"wallpaper1.jpg",
						"energy-17.jpg",
						"midnight-8.jpg",
						"wallpaper4.jpg",
						"wispysky.mp4",
						"cityscape.jpg",
						"ipad-17-light.jpg",
					],
				})),
			},
		});

		await expect(getAvailableWallpapers()).resolves.toEqual([
			BUILT_IN_WALLPAPERS[2],
			BUILT_IN_WALLPAPERS[4],
			BUILT_IN_WALLPAPERS[15],
			BUILT_IN_WALLPAPERS[16],
			BUILT_IN_WALLPAPERS[23],
			BUILT_IN_WALLPAPERS[24],
		]);
	});

	it("falls back to the default wallpaper when a bundled wallpaper is missing", async () => {
		vi.stubGlobal("window", {
			electronAPI: {
				listAssetDirectory: vi.fn().mockResolvedValue({
					success: true,
					files: ["wallpaper2.jpg"],
				}),
			},
		});

		await expect(resolveAvailableWallpaperPath("/wallpapers/midnight-8.jpg")).resolves.toBe(
			DEFAULT_WALLPAPER_PATH,
		);
		await expect(resolveAvailableWallpaperPath("/wallpapers/wallpaper2.jpg")).resolves.toBe(
			"/wallpapers/wallpaper2.jpg",
		);
	});

	it("strips query strings and fragments before checking bundled wallpaper files", async () => {
		vi.stubGlobal("window", {
			electronAPI: {
				listAssetDirectory: vi.fn().mockResolvedValue({
					success: true,
					files: ["wispysky.mp4"],
				}),
			},
		});

		await expect(resolveAvailableWallpaperPath("/wallpapers/wispysky.mp4#t=0.1")).resolves.toBe(
			"/wallpapers/wispysky.mp4#t=0.1",
		);
	});

	it("preserves non-bundled wallpaper values", async () => {
		await expect(resolveAvailableWallpaperPath("#123456")).resolves.toBe("#123456");
		await expect(resolveAvailableWallpaperPath("data:image/png;base64,abc")).resolves.toBe(
			"data:image/png;base64,abc",
		);
	});
});

describe("isDeviceImagePath", () => {
	it("recognises absolute local paths as images from the device", () => {
		expect(isDeviceImagePath("C:\\Users\\Me\\Pictures\\wall.jpg")).toBe(true);
		expect(isDeviceImagePath("D:/Wallpapers/mine.png")).toBe(true);
		expect(isDeviceImagePath("\\\\NAS\\share\\wall.jpg")).toBe(true);
		expect(isDeviceImagePath("/home/me/wall.jpg")).toBe(true);
	});

	it("does not treat bundled assets, URLs or styles as device images", () => {
		expect(isDeviceImagePath("/wallpapers/sonoma-light.jpg")).toBe(false);
		expect(isDeviceImagePath("/app-icons/example.png")).toBe(false);
		expect(isDeviceImagePath("wallpapers/sonoma-light.jpg")).toBe(false);
		expect(isDeviceImagePath("data:image/png;base64,abc")).toBe(false);
		expect(isDeviceImagePath("file:///C:/Users/Me/wall.jpg")).toBe(false);
		expect(isDeviceImagePath("http://127.0.0.1:1234/video?path=x")).toBe(false);
		expect(isDeviceImagePath("blob:http://localhost/abc")).toBe(false);
		expect(isDeviceImagePath("#123456")).toBe(false);
		expect(isDeviceImagePath("linear-gradient(90deg, #000, #fff)")).toBe(false);
		expect(isDeviceImagePath("")).toBe(false);
	});
});
