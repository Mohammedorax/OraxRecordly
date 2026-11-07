import type { ExportPipelineModel } from "./types";

/**
 * Automatic downgrade of an MP4 export to the legacy pipeline.
 *
 * Both pipelines render through Pixi (WebGL/WebGPU), so most renderer failures
 * are terminal. The remaining case is worth recovering from: the modern
 * ("Lightning") renderer initializes every backend it knows and throws
 * "No supported Pixi modern renderer was available" when none came up, while the
 * legacy exporter may still start — a machine where WebGPU is unusable and only
 * WebGL works, or a modern-only initialization path that fails.
 *
 * Only that specific condition is treated as recoverable. A cancelled export, a
 * disk error, or a code defect must keep failing loudly instead of being masked
 * by a silent second attempt.
 */
const RENDERER_UNAVAILABLE_MARKERS = [
	"no supported pixi modern renderer",
	"no supported pixi export backend",
] as const;

/**
 * Failures that come from the GPU renderer itself rather than from the project.
 *
 * Initialization is not the only way the modern renderer dies. On distributions
 * whose driver or Mesa build exposes a partly working backend, WebGPU comes up
 * successfully and the first frame then throws from inside Pixi's bind-group code
 * - the Linux report this list was written for says "Cannot read properties of
 * undefined (reading '_resourceType')" at zero rendered frames. That is a broken
 * renderer path, not a broken project, and the legacy canvas pipeline can still
 * finish the export.
 *
 * The patterns are deliberately renderer-specific: a missing source file, a disk
 * error or a cancellation must keep failing loudly instead of being retried.
 */
const RECOVERABLE_RENDERER_ERROR_PATTERNS: readonly RegExp[] = [
	/_resourceType/i,
	/alphaMode/i,
	/source is (?:null|undefined)/i,
	/pixi/i,
	/webgpu/i,
	/webgl/i,
	/shader/i,
	/bind ?group/i,
	/texture ?source/i,
	/is not a valid (?:webgpu|webgl|gpu) ?resource/i,
	/could not (?:create|initialize|initialise) (?:a )?(?:webgl|webgpu|gpu|renderer)/i,
	/**
	 * Encoder availability, not renderer breakage - but the same recovery applies.
	 * The legacy pipeline can hand raw frames to the bundled FFmpeg (libx264) when
	 * Chromium's WebCodecs H.264 encoder is missing, which is a real distribution
	 * difference: a build without the proprietary codec set simply has no
	 * `VideoEncoder` H.264 support, and the modern pipeline is WebCodecs-only.
	 */
	/videoencoder is not defined/i,
	/h\.264 encoding is not supported/i,
	/encoder path .* is not supported/i,
	/video encoding is not supported/i,
];

/** The message the modern renderer throws when no backend could be initialized. */
export function isRendererUnavailableExportError(message: string): boolean {
	const normalized = message.toLowerCase();
	return RENDERER_UNAVAILABLE_MARKERS.some((marker) => normalized.includes(marker));
}

/**
 * Whether an error is a renderer breakage the legacy pipeline may survive.
 *
 * Kept separate from {@link isRendererUnavailableExportError} so the two reasons
 * can be logged differently: init failures are expected on low-end machines,
 * render-time crashes point at a driver or Pixi backend regression.
 */
export function isRecoverableRendererExportError(message: string): boolean {
	if (isRendererUnavailableExportError(message)) {
		return true;
	}

	return RECOVERABLE_RENDERER_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

/** Whether the failed attempt should be retried once on the legacy pipeline. */
export function shouldFallBackToLegacyPipeline(options: {
	pipelineModel: ExportPipelineModel;
	alreadyFellBack: boolean;
	errorMessage: string;
}): boolean {
	return (
		options.pipelineModel === "modern" &&
		!options.alreadyFellBack &&
		isRecoverableRendererExportError(options.errorMessage)
	);
}

/**
 * What the user is told when the downgrade happens.
 *
 * Written as a single sentence so the toast stays readable, and phrased as an
 * explanation rather than an error: the export still finishes.
 */
export function describePipelineFallbackMessage(
	translations?: Partial<{ title: string; hint: string }>,
): { title: string; hint: string } {
	return {
		title: translations?.title ?? "Exporting without GPU acceleration",
		hint:
			translations?.hint ??
			"Hardware rendering is unavailable on this machine, so the video is rendered on the processor. It still works, just more slowly.",
	};
}

/**
 * Whether the editor preview has to be rebuilt once an export finishes.
 *
 * Rebuilding the preview is expensive: a new WebGL context, shader recompiles,
 * a video reload and a flash of the loading skeleton. Exporting never rebinds
 * the preview's source, so the rebuild is only warranted when the export ran on
 * a *different* renderer than the one the preview is currently using - which
 * happens exactly when the modern pipeline failed and the legacy one took over.
 */
export function shouldRemountPreviewAfterExport(options: {
	activePipelineModel: ExportPipelineModel;
	previewPipelineModel: ExportPipelineModel;
}): boolean {
	return options.activePipelineModel !== options.previewPipelineModel;
}

/**
 * Luma at or below this counts as "the renderer produced nothing".
 *
 * The modern pipeline can finish successfully while every frame it hands over is
 * black, which happens on machines whose GPU path does not actually render
 * (software adapters, virtual machines, a disabled driver). The file is
 * playable, so nothing else in the pipeline notices; the sampler is what makes
 * it visible.
 */
export const BLACK_FRAME_LUMA_THRESHOLD = 0.5;

/**
 * Whether a *successful* export should be retried once on the legacy pipeline
 * because the frames it rendered are black.
 *
 * Only the modern pipeline is retried: it is the one that can silently render
 * nothing, and the legacy renderer is the alternative the app already keeps for
 * machines without a usable GPU path. A second black result is reported to the
 * user rather than retried again.
 */
export function shouldRetryExportForBlackFrames(options: {
	pipelineModel: ExportPipelineModel;
	alreadyFellBack: boolean;
	sampledLuma?: number | null;
}): boolean {
	return (
		options.pipelineModel === "modern" &&
		!options.alreadyFellBack &&
		typeof options.sampledLuma === "number" &&
		Number.isFinite(options.sampledLuma) &&
		options.sampledLuma <= BLACK_FRAME_LUMA_THRESHOLD
	);
}
