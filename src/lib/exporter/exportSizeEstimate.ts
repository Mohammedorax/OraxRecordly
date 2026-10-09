import { getMp4ExportBitrate } from "./exportBitrate";
import type { ExportEncodingMode, ExportMp4FrameRate, ExportQuality } from "./types";

/** MP4 container/track overhead on top of the raw elementary-stream bitrate. */
const CONTAINER_OVERHEAD = 1.02;

/**
 * Rough delivered size for an MP4 export. Streaming rate control and scene
 * complexity move the real number by a few percent, so this is presented as an
 * estimate ("about 24 MB") rather than a promise.
 */
export function estimateMp4ExportSizeBytes(options: {
	width: number;
	height: number;
	frameRate: ExportMp4FrameRate;
	quality: ExportQuality;
	encodingMode: ExportEncodingMode;
	durationSec: number;
}): number {
	if (!Number.isFinite(options.durationSec) || options.durationSec <= 0) {
		return 0;
	}
	if (
		!Number.isFinite(options.width) ||
		!Number.isFinite(options.height) ||
		options.width <= 0 ||
		options.height <= 0
	) {
		return 0;
	}

	const bitrate = getMp4ExportBitrate({
		width: options.width,
		height: options.height,
		frameRate: options.frameRate,
		quality: options.quality,
		encodingMode: options.encodingMode,
	});

	return Math.round((bitrate / 8) * options.durationSec * CONTAINER_OVERHEAD);
}

const SIZE_UNITS = ["B", "KB", "MB", "GB"] as const;

export function formatEstimatedExportSize(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return "";
	}

	let value = bytes;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}

	const rounded =
		value >= 100 || unitIndex === 0 ? Math.round(value) : Math.round(value * 10) / 10;
	return `${rounded} ${SIZE_UNITS[unitIndex]}`;
}
