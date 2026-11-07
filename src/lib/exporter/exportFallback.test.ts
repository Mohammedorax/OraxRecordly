import { describe, expect, it } from "vitest";
import {
	describePipelineFallbackMessage,
	isRecoverableRendererExportError,
	isRendererUnavailableExportError,
	shouldFallBackToLegacyPipeline,
	shouldRemountPreviewAfterExport,
	shouldRetryExportForBlackFrames,
} from "./exportFallback";

/** The exact message a GPU-less machine produced. */
const CI_RENDERER_UNAVAILABLE_MESSAGE = [
	"Lightning (Beta) export failed.",
	"Reason: No supported Pixi modern renderer was available. Attempted:",
	"webgpu: CanvasRenderer is not yet implemented (after 0ms) |",
	"webgl: CanvasRenderer is not yet implemented (after 0ms)",
].join(" ");

describe("export pipeline fallback", () => {
	it("recognizes the renderer-unavailable failure", () => {
		expect(isRendererUnavailableExportError(CI_RENDERER_UNAVAILABLE_MESSAGE)).toBe(true);
		expect(
			isRendererUnavailableExportError("No supported Pixi export backend was available."),
		).toBe(true);
	});

	it("leaves every other failure alone", () => {
		expect(isRendererUnavailableExportError("Export canceled")).toBe(false);
		expect(isRendererUnavailableExportError("ENOSPC: no space left on device")).toBe(false);
		expect(isRendererUnavailableExportError("Unable to decode the source video")).toBe(false);
	});

	it("recognizes a renderer that crashes after a successful init", () => {
		// The Fedora/Linux report: WebGPU initialized, then the first frame threw from
		// inside Pixi's bind-group code, so the export died with zero frames rendered.
		const linuxWebGpuCrash =
			"Lightning (Beta) export failed. Reason: Cannot read properties of undefined (reading '_resourceType')";
		expect(isRecoverableRendererExportError(linuxWebGpuCrash)).toBe(true);
		expect(
			shouldFallBackToLegacyPipeline({
				pipelineModel: "modern",
				alreadyFellBack: false,
				errorMessage: linuxWebGpuCrash,
			}),
		).toBe(true);

		// The same renderer markers from a WebGL failure are recoverable too.
		expect(
			isRecoverableRendererExportError(
				"Shader compilation failed while creating the export renderer",
			),
		).toBe(true);
	});

	it("retries on the legacy pipeline when the platform has no WebCodecs H.264 encoder", () => {
		// The legacy pipeline can encode through the bundled FFmpeg, so a distribution
		// build without Chromium's proprietary codecs is recoverable rather than fatal.
		expect(isRecoverableRendererExportError("VideoEncoder is not defined")).toBe(true);
		expect(
			isRecoverableRendererExportError("H.264 encoding is not supported on this system"),
		).toBe(true);
	});

	it("recognizes a texture destroyed while still on screen", () => {
		// Seen during a cross-dissolve on Windows: the held outgoing texture was
		// destroyed by the staging-mode switch, then read as a null source.
		const message =
			"Lightning (Beta) export failed. Reason: Cannot read properties of null (reading 'alphaMode')";
		expect(isRecoverableRendererExportError(message)).toBe(true);
		expect(
			shouldFallBackToLegacyPipeline({
				pipelineModel: "modern",
				alreadyFellBack: false,
				errorMessage: message,
			}),
		).toBe(true);
	});

	it("still refuses to mask project failures as renderer problems", () => {
		for (const message of [
			"ENOSPC: no space left on device",
			"Export canceled",
			"Unable to decode the source video",
			"The project file could not be read",
		]) {
			expect(isRecoverableRendererExportError(message)).toBe(false);
		}
	});

	it("retries once on the legacy pipeline", () => {
		expect(
			shouldFallBackToLegacyPipeline({
				pipelineModel: "modern",
				alreadyFellBack: false,
				errorMessage: CI_RENDERER_UNAVAILABLE_MESSAGE,
			}),
		).toBe(true);

		expect(
			shouldFallBackToLegacyPipeline({
				pipelineModel: "modern",
				alreadyFellBack: true,
				errorMessage: CI_RENDERER_UNAVAILABLE_MESSAGE,
			}),
		).toBe(false);

		expect(
			shouldFallBackToLegacyPipeline({
				pipelineModel: "legacy",
				alreadyFellBack: false,
				errorMessage: CI_RENDERER_UNAVAILABLE_MESSAGE,
			}),
		).toBe(false);

		expect(
			shouldFallBackToLegacyPipeline({
				pipelineModel: "modern",
				alreadyFellBack: false,
				errorMessage: "ENOSPC: no space left on device",
			}),
		).toBe(false);
	});

	it("explains the downgrade in plain language", () => {
		const message = describePipelineFallbackMessage();
		expect(message.title).toContain("GPU");
		expect(message.hint.toLowerCase()).toContain("processor");

		const localized = describePipelineFallbackMessage({
			title: "عنوان",
			hint: "تفصيل",
		});
		expect(localized).toEqual({ title: "عنوان", hint: "تفصيل" });
	});

	it("keeps the preview mounted after a normal export", () => {
		expect(
			shouldRemountPreviewAfterExport({
				activePipelineModel: "modern",
				previewPipelineModel: "modern",
			}),
		).toBe(false);

		expect(
			shouldRemountPreviewAfterExport({
				activePipelineModel: "legacy",
				previewPipelineModel: "modern",
			}),
		).toBe(true);
	});

	describe("black-frame retry", () => {
		it("retries a successful modern export whose frames were black", () => {
			expect(
				shouldRetryExportForBlackFrames({
					pipelineModel: "modern",
					alreadyFellBack: false,
					sampledLuma: 0,
				}),
			).toBe(true);
		});

		it("leaves a healthy export alone", () => {
			expect(
				shouldRetryExportForBlackFrames({
					pipelineModel: "modern",
					alreadyFellBack: false,
					sampledLuma: 101.2,
				}),
			).toBe(false);
		});

		it("never retries twice, on the legacy pipeline, or without a measurement", () => {
			expect(
				shouldRetryExportForBlackFrames({
					pipelineModel: "modern",
					alreadyFellBack: true,
					sampledLuma: 0,
				}),
			).toBe(false);
			expect(
				shouldRetryExportForBlackFrames({
					pipelineModel: "legacy",
					alreadyFellBack: false,
					sampledLuma: 0,
				}),
			).toBe(false);
			expect(
				shouldRetryExportForBlackFrames({
					pipelineModel: "modern",
					alreadyFellBack: false,
					sampledLuma: undefined,
				}),
			).toBe(false);
		});
	});
});
