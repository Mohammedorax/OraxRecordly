import { describe, expect, it } from "vitest";
import {
	describePipelineFallbackMessage,
	isRendererUnavailableExportError,
	shouldFallBackToLegacyPipeline,
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
});
