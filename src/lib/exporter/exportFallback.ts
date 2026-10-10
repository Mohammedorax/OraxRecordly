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

/** The message the modern renderer throws when no backend could be initialized. */
export function isRendererUnavailableExportError(message: string): boolean {
	const normalized = message.toLowerCase();
	return RENDERER_UNAVAILABLE_MARKERS.some((marker) => normalized.includes(marker));
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
		isRendererUnavailableExportError(options.errorMessage)
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
