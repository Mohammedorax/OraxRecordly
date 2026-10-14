import type { ExportMetrics } from "./types";

/**
 * The export report a user can paste into a message.
 *
 * Performance work on a machine nobody can sit at needs numbers from that
 * machine: where the seconds go (decode, render, encode wait), which encoder was
 * chosen, and how many frames were produced. The report is deliberately plain
 * `key: value` text - language-neutral, easy to read in a chat, easy to compare
 * between two runs.
 */

export interface ExportReportInput {
	/** App version, so a report is never matched against the wrong build. */
	appVersion?: string;
	format: "mp4" | "gif";
	/** Where the frames were rendered: modern Pixi pipeline or the legacy canvas. */
	pipelineModel?: string | null;
	width?: number;
	height?: number;
	frameRate?: number;
	durationSec?: number;
	metrics?: ExportMetrics | null;
	/** True when this run was a retry after a black-frame detection. */
	retriedForBlackFrames?: boolean;
	/** Populated when the export failed instead of finishing. */
	error?: string | null;
}

function line(label: string, value: string | number | undefined | null): string | null {
	if (value === undefined || value === null || value === "") {
		return null;
	}
	return `${label}: ${value}`;
}

function seconds(ms: number | undefined): string | null {
	if (typeof ms !== "number" || !Number.isFinite(ms)) {
		return null;
	}
	return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * A percentage of the total, the single most useful number in the report: it says
 * whether the export was waiting on decoding, drawing or encoding.
 */
function share(ms: number | undefined, totalMs: number | undefined): string | null {
	if (
		typeof ms !== "number" ||
		typeof totalMs !== "number" ||
		!Number.isFinite(ms) ||
		!Number.isFinite(totalMs) ||
		totalMs <= 0
	) {
		return null;
	}
	return `${(ms / 1000).toFixed(1)}s (${Math.round((ms / totalMs) * 100)}%)`;
}

export function formatExportReport(input: ExportReportInput): string {
	const metrics = input.metrics ?? null;
	const totalMs = metrics?.totalElapsedMs;
	const frameCount = metrics?.frameCount;
	const lines: Array<string | null> = [
		`OraxRecordly export report${input.appVersion ? ` - v${input.appVersion}` : ""}`,
		`result: ${input.error ? "failed" : "ok"}${input.retriedForBlackFrames ? " (retried on the legacy pipeline)" : ""}`,
		`format: ${input.format}`,
		line("output", input.width && input.height ? `${input.width}x${input.height}` : undefined),
		line("frame rate", input.frameRate ? `${input.frameRate} fps` : undefined),
		line(
			"duration",
			typeof input.durationSec === "number" ? `${input.durationSec.toFixed(2)}s` : undefined,
		),
		line("pipeline", input.pipelineModel ?? undefined),
		line("render backend", metrics?.renderBackend),
		line("encode backend", metrics?.encodeBackend),
		line("encoder", metrics?.encoderName),
		line("backpressure profile", metrics?.backpressureProfile),
		line("frames", frameCount),
		line(
			"average fps",
			typeof frameCount === "number" && typeof totalMs === "number" && totalMs > 0
				? (frameCount / (totalMs / 1000)).toFixed(1)
				: undefined,
		),
		line("elapsed", seconds(totalMs)),
		line("  metadata load", seconds(metrics?.metadataLoadMs)),
		line("  renderer init", seconds(metrics?.rendererInitMs)),
		line("  decode loop", share(metrics?.decodeLoopMs, totalMs)),
		line("  render frames", share(metrics?.renderFrameMs, totalMs)),
		line("  encode wait", share(metrics?.encodeWaitMs, totalMs)),
		line("  frame callback", share(metrics?.frameCallbackMs, totalMs)),
		line("  native capture", share(metrics?.nativeCaptureMs, totalMs)),
		line("  native write", share(metrics?.nativeWriteMs, totalMs)),
		line("  finalization", share(metrics?.finalizationMs, totalMs)),
		line("peak encode queue", metrics?.peakEncodeQueueSize),
		line("sampled luma", metrics?.sampledLuma),
		line("static layout skipped", metrics?.nativeStaticLayoutSkipReason),
	];

	if (input.error) {
		lines.push(`error: ${input.error}`);
	}

	return lines.filter((entry): entry is string => entry !== null).join("\n");
}
