import { describe, expect, it } from "vitest";
import { estimateMp4ExportSizeBytes, formatEstimatedExportSize } from "./exportSizeEstimate";

describe("export size estimate", () => {
	it("scales linearly with duration at a fixed bitrate", () => {
		const options = {
			width: 1920,
			height: 1080,
			frameRate: 30 as const,
			quality: "good" as const,
			encodingMode: "balanced" as const,
		};

		const sixtySeconds = estimateMp4ExportSizeBytes({ ...options, durationSec: 60 });
		const oneTwentySeconds = estimateMp4ExportSizeBytes({ ...options, durationSec: 120 });

		expect(sixtySeconds).toBeGreaterThan(0);
		expect(oneTwentySeconds).toBeCloseTo(sixtySeconds * 2, -1);
	});

	it("grows with resolution and quality", () => {
		const base = {
			frameRate: 30 as const,
			quality: "good" as const,
			encodingMode: "balanced" as const,
			durationSec: 60,
		};

		const hd = estimateMp4ExportSizeBytes({ ...base, width: 1280, height: 720 });
		const fullHd = estimateMp4ExportSizeBytes({ ...base, width: 1920, height: 1080 });
		const uhd = estimateMp4ExportSizeBytes({ ...base, width: 3840, height: 2160 });

		expect(hd).toBeLessThan(fullHd);
		expect(fullHd).toBeLessThan(uhd);
	});

	it("returns zero for unusable input instead of a bogus size", () => {
		expect(
			estimateMp4ExportSizeBytes({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "good",
				encodingMode: "balanced",
				durationSec: 0,
			}),
		).toBe(0);
		expect(
			estimateMp4ExportSizeBytes({
				width: 0,
				height: 0,
				frameRate: 30,
				quality: "good",
				encodingMode: "balanced",
				durationSec: 60,
			}),
		).toBe(0);
	});

	it("formats sizes for display", () => {
		expect(formatEstimatedExportSize(0)).toBe("");
		expect(formatEstimatedExportSize(900)).toBe("900 B");
		expect(formatEstimatedExportSize(1024 * 1024 * 12.34)).toBe("12.3 MB");
		expect(formatEstimatedExportSize(1024 * 1024 * 1024 * 2.5)).toBe("2.5 GB");
	});
});
