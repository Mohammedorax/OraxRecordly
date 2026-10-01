import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type DeviceWallpaperImage,
	listDeviceWallpaperImages,
	pickDeviceWallpaperImage,
	withSelectedDeviceWallpaper,
} from "./systemWallpapers";

function createImage(overrides: Partial<DeviceWallpaperImage> = {}): DeviceWallpaperImage {
	return {
		path: "C:\\Users\\Me\\Pictures\\one.jpg",
		name: "One",
		source: "pictures",
		url: "http://127.0.0.1:1234/video?path=one.jpg",
		...overrides,
	};
}

describe("system wallpapers (renderer)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("reports an empty scan when the preload API is unavailable", async () => {
		vi.stubGlobal("window", {});
		await expect(listDeviceWallpaperImages()).resolves.toEqual({
			images: [],
			truncated: false,
		});
	});

	it("returns the scanned images from the main process", async () => {
		const image = createImage();
		vi.stubGlobal("window", {
			electronAPI: {
				listSystemWallpapers: vi.fn(async () => ({
					success: true,
					images: [image],
					truncated: true,
				})),
			},
		});

		await expect(listDeviceWallpaperImages()).resolves.toEqual({
			images: [image],
			truncated: true,
		});
	});

	it("surfaces scan failures without throwing", async () => {
		vi.stubGlobal("window", {
			electronAPI: {
				listSystemWallpapers: vi.fn(async () => ({
					success: false,
					images: [],
					error: "boom",
				})),
			},
		});

		await expect(listDeviceWallpaperImages()).resolves.toEqual({
			images: [],
			truncated: false,
			error: "boom",
		});
	});

	it("returns the browsed image and treats cancel as a no-op", async () => {
		const pickSystemWallpaperImage = vi
			.fn()
			.mockResolvedValueOnce({ success: false, canceled: true })
			.mockResolvedValueOnce({ success: true, image: createImage({ source: "browse" }) });
		vi.stubGlobal("window", { electronAPI: { pickSystemWallpaperImage } });

		await expect(pickDeviceWallpaperImage()).resolves.toEqual({ canceled: true });
		await expect(pickDeviceWallpaperImage()).resolves.toEqual({
			image: createImage({ source: "browse" }),
			canceled: false,
		});
	});

	it("keeps the selected device image in the grid even when the scan missed it", () => {
		const scanned = createImage();
		const selectedPath = "D:\\Other\\chosen image.png";

		const merged = withSelectedDeviceWallpaper([scanned], selectedPath);

		expect(merged).toHaveLength(2);
		expect(merged[0]).toMatchObject({
			path: selectedPath,
			name: "chosen image",
			source: "browse",
		});
		expect(withSelectedDeviceWallpaper([scanned], scanned.path)).toEqual([scanned]);
		expect(withSelectedDeviceWallpaper([scanned], "")).toEqual([scanned]);
	});
});
