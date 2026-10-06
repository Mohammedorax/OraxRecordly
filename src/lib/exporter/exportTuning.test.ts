import { describe, expect, it } from "vitest";

import {
	getExportBackpressureProfile,
	getPreferredWebCodecsLatencyModes,
	getWebCodecsEncodeQueueLimit,
	getWebCodecsKeyFrameInterval,
} from "./exportTuning";

describe("exportTuning", () => {
	it("prefers realtime latency only for the dedicated fast mode", () => {
		expect(getPreferredWebCodecsLatencyModes("fast")).toEqual(["realtime", "quality"]);
		expect(getPreferredWebCodecsLatencyModes("balanced")).toEqual(["quality", "realtime"]);
		expect(getPreferredWebCodecsLatencyModes("quality")).toEqual(["quality", "realtime"]);
	});

	it("keeps queue depth bounded by encoding mode", () => {
		expect(getWebCodecsEncodeQueueLimit(60, "fast")).toBe(75);
		expect(getWebCodecsEncodeQueueLimit(60, "balanced")).toBe(120);
		expect(getWebCodecsEncodeQueueLimit(60, "quality")).toBe(144);
		expect(getWebCodecsEncodeQueueLimit(240, "fast")).toBe(96);
		expect(getWebCodecsEncodeQueueLimit(12, "balanced")).toBe(72);
	});

	it("caps the encode queue by retained frame memory at high resolutions", () => {
		// 4K quality would otherwise retain 144 NV12 frames (~1.8 GB).
		expect(getWebCodecsEncodeQueueLimit(60, "quality", { width: 3840, height: 2160 })).toBe(43);
		expect(
			getWebCodecsEncodeQueueLimit(60, "balanced", { width: 3840, height: 2160 }),
		).toBeLessThan(120);
		// HD and below keep their tuned frame counts.
		expect(getWebCodecsEncodeQueueLimit(60, "balanced", { width: 1920, height: 1080 })).toBe(
			120,
		);
		expect(getWebCodecsEncodeQueueLimit(60, "quality", { width: 1280, height: 720 })).toBe(144);
		// A byte budget still leaves enough in flight to keep the encoder fed.
		expect(
			getWebCodecsEncodeQueueLimit(60, "quality", { width: 7680, height: 4320 }),
		).toBeGreaterThanOrEqual(8);
	});

	it("widens keyframe spacing for faster modes", () => {
		expect(getWebCodecsKeyFrameInterval(60, "fast")).toBe(240);
		expect(getWebCodecsKeyFrameInterval(60, "balanced")).toBe(180);
		expect(getWebCodecsKeyFrameInterval(60, "quality")).toBe(150);
	});

	it("uses shallower decode buffers for Breeze than for WebCodecs", () => {
		const webCodecsProfile = getExportBackpressureProfile({
			encodeBackend: "webcodecs",
			width: 1280,
			height: 720,
			frameRate: 60,
			encodingMode: "balanced",
			hardwareConcurrency: 8,
		});
		const breezeProfile = getExportBackpressureProfile({
			encodeBackend: "ffmpeg",
			width: 1280,
			height: 720,
			frameRate: 60,
			encodingMode: "balanced",
			hardwareConcurrency: 8,
		});

		expect(webCodecsProfile.name).toBe("webcodecs-balanced-plus");
		expect(webCodecsProfile.maxDecodeQueue).toBe(12);
		expect(webCodecsProfile.maxPendingFrames).toBe(32);
		expect(breezeProfile.name).toBe("breeze-balanced-plus");
		expect(breezeProfile.maxDecodeQueue).toBe(14);
		expect(breezeProfile.maxPendingFrames).toBe(40);
		expect(breezeProfile.maxInFlightNativeWrites).toBe(8);
	});

	it("falls back to conservative native settings on low-core or very heavy workloads", () => {
		const breezeLowCoreProfile = getExportBackpressureProfile({
			encodeBackend: "ffmpeg",
			width: 1280,
			height: 720,
			frameRate: 60,
			hardwareConcurrency: 4,
		});
		const breezeHeavyProfile = getExportBackpressureProfile({
			encodeBackend: "ffmpeg",
			width: 3840,
			height: 2160,
			frameRate: 60,
			hardwareConcurrency: 12,
		});

		expect(breezeLowCoreProfile.name).toBe("breeze-conservative");
		expect(breezeLowCoreProfile.maxDecodeQueue).toBe(8);
		expect(breezeLowCoreProfile.maxPendingFrames).toBe(16);
		expect(breezeLowCoreProfile.maxInFlightNativeWrites).toBe(2);

		expect(breezeHeavyProfile.name).toBe("breeze-conservative");
		expect(breezeHeavyProfile.maxDecodeQueue).toBe(8);
		expect(breezeHeavyProfile.maxPendingFrames).toBe(16);
	});
});
