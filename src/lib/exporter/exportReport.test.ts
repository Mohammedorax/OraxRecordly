import { describe, expect, it } from "vitest";
import { formatExportReport } from "./exportReport";

const metrics = {
	totalElapsedMs: 41_200,
	metadataLoadMs: 900,
	rendererInitMs: 120,
	decodeLoopMs: 38_100,
	renderFrameMs: 21_400,
	encodeWaitMs: 11_200,
	frameCount: 360,
	effectiveDurationSec: 12,
	renderBackend: "webgpu" as const,
	encodeBackend: "webcodecs" as const,
	encoderName: "avc1.640033/prefer-hardware/quality",
	backpressureProfile: "webcodecs-balanced",
	peakEncodeQueueSize: 24,
	sampledLuma: 101.1,
};

describe("export report", () => {
	it("summarises an export with the phase shares", () => {
		const report = formatExportReport({
			appVersion: "1.12.2",
			format: "mp4",
			pipelineModel: "modern",
			width: 1920,
			height: 1080,
			frameRate: 30,
			durationSec: 12,
			metrics,
		});

		expect(report).toContain("OraxRecordly export report - v1.12.2");
		expect(report).toContain("result: ok");
		expect(report).toContain("output: 1920x1080");
		expect(report).toContain("encoder: avc1.640033/prefer-hardware/quality");
		expect(report).toContain("frames: 360");
		// 360 frames over 41.2s is 8.7 fps, and the shares answer "what was slow?".
		expect(report).toContain("average fps: 8.7");
		expect(report).toContain("decode loop: 38.1s (92%)");
		expect(report).toContain("render frames: 21.4s (52%)");
		expect(report).toContain("encode wait: 11.2s (27%)");
		expect(report).toContain("sampled luma: 101.1");
	});

	it("marks a failed export and includes the reason", () => {
		const report = formatExportReport({
			format: "mp4",
			error: "Lightning (Beta) export failed.",
		});

		expect(report).toContain("result: failed");
		expect(report).toContain("error: Lightning (Beta) export failed.");
		// Nothing to report about metrics, so no empty lines are emitted.
		expect(report).not.toContain("elapsed:");
		expect(report.split("\n").every((line) => line.trim() !== "")).toBe(true);
	});

	it("notes a black-frame retry and omits values it does not have", () => {
		const report = formatExportReport({
			format: "mp4",
			pipelineModel: "legacy",
			retriedForBlackFrames: true,
			metrics: { totalElapsedMs: 61_000, frameCount: 120, sampledLuma: 138.1 },
		});

		expect(report).toContain("result: ok (retried on the legacy pipeline)");
		expect(report).toContain("pipeline: legacy");
		expect(report).toContain("average fps: 2.0");
		expect(report).not.toContain("encoder:");
		expect(report).not.toContain("render backend:");
	});

	it("never divides by a missing or zero total", () => {
		const report = formatExportReport({
			format: "mp4",
			metrics: { totalElapsedMs: 0, frameCount: 10 },
		});

		expect(report).not.toContain("average fps");
		expect(report).not.toContain("NaN");
		expect(report).not.toContain("Infinity");
	});
});
