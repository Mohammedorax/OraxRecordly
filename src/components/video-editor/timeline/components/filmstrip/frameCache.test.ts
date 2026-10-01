import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clearFrameCache,
	extractFilmstrip,
	frameCacheKey,
	readCachedFrame,
	writeCachedFrame,
} from "./frameCache";

/** Stand-in for an `ImageBitmap`; the Node test environment has no DOM decoder. */
function fakeBitmap() {
	return { close: vi.fn() };
}

afterEach(() => {
	clearFrameCache();
});

describe("filmstrip frame cache keys", () => {
	it("buckets nearby sample times onto the same key", () => {
		expect(frameCacheKey("/clips/a.mp4", 1004)).toBe(frameCacheKey("/clips/a.mp4", 1049));
	});

	it("keeps sample times more than a bucket apart distinct", () => {
		expect(frameCacheKey("/clips/a.mp4", 1004)).not.toBe(frameCacheKey("/clips/a.mp4", 1204));
	});

	it("never mixes two sources in the same bucket", () => {
		expect(frameCacheKey("/clips/a.mp4", 1000)).not.toBe(frameCacheKey("/clips/b.mp4", 1040));
	});
});

describe("filmstrip extraction abort handling", () => {
	it("resolves empty for an aborted request without creating a decoder or bitmap", async () => {
		// This environment has no DOM, so reaching <video>/createImageBitmap would throw:
		// resolving here proves the abort branch bails out before any decoding work.
		const controller = new AbortController();
		controller.abort();

		await expect(
			extractFilmstrip("/clips/a.mp4", [0, 1000], controller.signal),
		).resolves.toEqual([]);
	});
});

describe("filmstrip frame cache lifetime", () => {
	it("closes the bitmap evicted by the 256 entry bound", () => {
		const bitmaps = Array.from({ length: 257 }, () => fakeBitmap());
		bitmaps.forEach((bitmap, index) =>
			writeCachedFrame(`/clips/a.mp4:${index}`, bitmap as unknown as ImageBitmap),
		);

		expect(bitmaps[0].close).toHaveBeenCalledTimes(1);
		expect(bitmaps[1].close).not.toHaveBeenCalled();
		expect(bitmaps[256].close).not.toHaveBeenCalled();
		expect(readCachedFrame("/clips/a.mp4:0")).toBeUndefined();
	});

	it("closes the bitmap it replaces when a bucket is rewritten", () => {
		const first = fakeBitmap();
		const second = fakeBitmap();
		writeCachedFrame("/clips/a.mp4:10", first as unknown as ImageBitmap);
		writeCachedFrame("/clips/a.mp4:10", second as unknown as ImageBitmap);

		expect(first.close).toHaveBeenCalledTimes(1);
		expect(second.close).not.toHaveBeenCalled();
		expect(readCachedFrame("/clips/a.mp4:10")).toBe(second);
	});

	it("closes every cached bitmap when the cache is cleared", () => {
		const bitmap = fakeBitmap();
		writeCachedFrame("/clips/a.mp4:20", bitmap as unknown as ImageBitmap);
		clearFrameCache();

		expect(bitmap.close).toHaveBeenCalledTimes(1);
		expect(readCachedFrame("/clips/a.mp4:20")).toBeUndefined();
	});
});
