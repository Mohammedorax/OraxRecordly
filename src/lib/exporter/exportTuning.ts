import type { ExportEncodeBackend, ExportEncodingMode } from "./types";

const DEFAULT_ENCODING_MODE: ExportEncodingMode = "balanced";
type WebCodecsLatencyMode = "quality" | "realtime";
const BASELINE_PIXELS_PER_SECOND = 1280 * 720 * 60;

const LATENCY_MODE_PREFERENCES: Record<ExportEncodingMode, readonly WebCodecsLatencyMode[]> = {
	fast: ["realtime", "quality"],
	// "realtime" maps to a zerolatency-style tune (no lookahead/B-frames) in Chrome.
	// Only the dedicated fast mode should pay that quality cost; balanced and quality
	// prefer the quality tune and fall back to realtime when the platform rejects it.
	balanced: ["quality", "realtime"],
	quality: ["quality", "realtime"],
};

const TARGET_QUEUE_SECONDS: Record<ExportEncodingMode, number> = {
	fast: 1.25,
	balanced: 2,
	quality: 2.4,
};

const MIN_QUEUE_LIMIT: Record<ExportEncodingMode, number> = {
	fast: 36,
	balanced: 72,
	quality: 96,
};

const MAX_QUEUE_LIMIT: Record<ExportEncodingMode, number> = {
	fast: 96,
	balanced: 120,
	quality: 180,
};

/**
 * Frames waiting in a WebCodecs encoder are retained in full. Without a byte
 * budget a 4K quality export can queue ~144 frames (~1.8 GB of NV12), which is
 * enough to push 8-16 GB machines into swap or an OOM abort. The byte budget
 * only starts to bite above ~3K; 720p/1080p keep their tuned frame counts.
 */
const MAX_QUEUED_FRAME_BYTES = 512 * 1024 * 1024;
const MIN_BYTE_BUDGETED_QUEUE_LIMIT = 8;

const KEYFRAME_INTERVAL_SECONDS: Record<ExportEncodingMode, number> = {
	fast: 4,
	balanced: 3,
	quality: 2.5,
};

function normalizeEncodingMode(encodingMode?: ExportEncodingMode): ExportEncodingMode {
	return encodingMode ?? DEFAULT_ENCODING_MODE;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function getEffectiveHardwareConcurrency(hardwareConcurrency?: number): number {
	if (typeof hardwareConcurrency === "number" && Number.isFinite(hardwareConcurrency)) {
		return Math.max(1, Math.floor(hardwareConcurrency));
	}

	if (
		typeof navigator !== "undefined" &&
		typeof navigator.hardwareConcurrency === "number" &&
		Number.isFinite(navigator.hardwareConcurrency)
	) {
		return Math.max(1, Math.floor(navigator.hardwareConcurrency));
	}

	return 8;
}

function getRelativePixelRate(width: number, height: number, frameRate: number): number {
	return (
		(Math.max(1, width) * Math.max(1, height) * Math.max(1, frameRate)) /
		BASELINE_PIXELS_PER_SECOND
	);
}

export interface ExportBackpressureProfile {
	name: string;
	maxEncodeQueue: number;
	maxDecodeQueue: number;
	maxPendingFrames: number;
	maxInFlightNativeWrites: number;
}

interface ExportBackpressureProfileOptions {
	encodeBackend: ExportEncodeBackend;
	width: number;
	height: number;
	frameRate: number;
	encodingMode?: ExportEncodingMode;
	hardwareConcurrency?: number;
}

export function getPreferredWebCodecsLatencyModes(
	encodingMode?: ExportEncodingMode,
): readonly WebCodecsLatencyMode[] {
	return LATENCY_MODE_PREFERENCES[normalizeEncodingMode(encodingMode)];
}

export function getWebCodecsEncodeQueueLimit(
	frameRate: number,
	encodingMode?: ExportEncodingMode,
	dimensions?: { width: number; height: number },
): number {
	const resolvedEncodingMode = normalizeEncodingMode(encodingMode);
	const targetLimit = Math.round(frameRate * TARGET_QUEUE_SECONDS[resolvedEncodingMode]);

	const frameLimit = clamp(
		targetLimit,
		MIN_QUEUE_LIMIT[resolvedEncodingMode],
		MAX_QUEUE_LIMIT[resolvedEncodingMode],
	);
	if (!dimensions) {
		return frameLimit;
	}
	if (
		!Number.isFinite(dimensions.width) ||
		!Number.isFinite(dimensions.height) ||
		dimensions.width <= 0 ||
		dimensions.height <= 0
	) {
		return frameLimit;
	}

	// 8-bit NV12 is what decoders hand to the encoder: 1.5 bytes per pixel.
	const frameBytes = Math.max(1, Math.floor(dimensions.width * dimensions.height * 1.5));
	const byteBudgetLimit = Math.floor(MAX_QUEUED_FRAME_BYTES / frameBytes);

	return Math.max(MIN_BYTE_BUDGETED_QUEUE_LIMIT, Math.min(frameLimit, byteBudgetLimit));
}

export function getWebCodecsKeyFrameInterval(
	frameRate: number,
	encodingMode?: ExportEncodingMode,
): number {
	const resolvedEncodingMode = normalizeEncodingMode(encodingMode);
	return Math.max(1, Math.round(frameRate * KEYFRAME_INTERVAL_SECONDS[resolvedEncodingMode]));
}

export function getExportBackpressureProfile(
	options: ExportBackpressureProfileOptions,
): ExportBackpressureProfile {
	const hardwareConcurrency = getEffectiveHardwareConcurrency(options.hardwareConcurrency);
	const relativePixelRate = getRelativePixelRate(
		options.width,
		options.height,
		options.frameRate,
	);
	const isLowCoreSystem = hardwareConcurrency <= 4;
	const isHighCoreSystem = hardwareConcurrency >= 8;
	const isHeavyWorkload = relativePixelRate >= 1.5;
	const isExtremeWorkload = relativePixelRate >= 3;
	const maxEncodeQueue = getWebCodecsEncodeQueueLimit(options.frameRate, options.encodingMode, {
		width: options.width,
		height: options.height,
	});

	if (options.encodeBackend === "ffmpeg") {
		if (isLowCoreSystem || isExtremeWorkload) {
			return {
				name: "breeze-conservative",
				maxEncodeQueue,
				maxDecodeQueue: 8,
				maxPendingFrames: 16,
				maxInFlightNativeWrites: 2,
			};
		}

		if (isHighCoreSystem && !isHeavyWorkload) {
			return {
				name: "breeze-balanced-plus",
				maxEncodeQueue,
				maxDecodeQueue: 14,
				maxPendingFrames: 40,
				maxInFlightNativeWrites: 8,
			};
		}

		return {
			name: "breeze-balanced",
			maxEncodeQueue,
			maxDecodeQueue: 12,
			maxPendingFrames: 28,
			maxInFlightNativeWrites: 4,
		};
	}

	if (isLowCoreSystem || isExtremeWorkload) {
		return {
			name: "webcodecs-conservative",
			maxEncodeQueue,
			maxDecodeQueue: 8,
			maxPendingFrames: 20,
			maxInFlightNativeWrites: 1,
		};
	}

	if (isHighCoreSystem && !isHeavyWorkload) {
		return {
			name: "webcodecs-balanced-plus",
			maxEncodeQueue,
			maxDecodeQueue: 12,
			maxPendingFrames: 32,
			maxInFlightNativeWrites: 1,
		};
	}

	return {
		name: "webcodecs-balanced",
		maxEncodeQueue,
		maxDecodeQueue: 10,
		maxPendingFrames: 24,
		maxInFlightNativeWrites: 1,
	};
}
