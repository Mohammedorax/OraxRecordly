import { describe, expect, it } from "vitest";
import {
	describeExportRendererCapability,
	detectExportRendererCapability,
} from "./rendererCapability";

function createFakeContext(rendererName: string) {
	return {
		getExtension: (name: string) =>
			name === "WEBGL_debug_renderer_info" ? { UNMASKED_RENDERER_WEBGL: 1 } : null,
		getParameter: (parameter: unknown) => (parameter === 1 ? rendererName : 0),
		RENDERER: 2,
	};
}

function createFakeDocument(context: unknown) {
	return {
		createElement: () => ({
			getContext: () => context,
		}),
	} as unknown as Pick<Document, "createElement">;
}

describe("export renderer capability probe", () => {
	it("reports nothing when there is no document", () => {
		expect(detectExportRendererCapability({})).toEqual({
			webgl: false,
			webgpu: false,
			hardwareAccelerated: false,
		});
	});

	it("detects a hardware WebGL context", () => {
		const capability = detectExportRendererCapability({
			document: createFakeDocument(createFakeContext("ANGLE (NVIDIA GeForce RTX 3060)")),
			navigator: {} as Navigator,
		});

		expect(capability.webgl).toBe(true);
		expect(capability.hardwareAccelerated).toBe(true);
		expect(capability.webgpu).toBe(false);
	});

	it("flags a software rasterizer as not hardware accelerated", () => {
		const capability = detectExportRendererCapability({
			document: createFakeDocument(createFakeContext("Google SwiftShader")),
			navigator: { gpu: {} } as unknown as Navigator,
		});

		expect(capability.webgl).toBe(true);
		expect(capability.hardwareAccelerated).toBe(false);
		expect(capability.webgpu).toBe(true);
	});

	it("detects the no-context machine that cannot export", () => {
		const capability = detectExportRendererCapability({
			document: createFakeDocument(null),
			navigator: {} as Navigator,
		});

		expect(capability).toEqual({ webgl: false, webgpu: false, hardwareAccelerated: false });
	});

	it("describes the probe for logs and support reports", () => {
		expect(
			describeExportRendererCapability({
				webgl: false,
				webgpu: false,
				hardwareAccelerated: false,
			}),
		).toContain("no WebGL or WebGPU");
		expect(
			describeExportRendererCapability({
				webgl: true,
				webgpu: true,
				hardwareAccelerated: true,
			}),
		).toBe("WebGL + WebGPU");
		expect(
			describeExportRendererCapability({
				webgl: true,
				webgpu: false,
				hardwareAccelerated: false,
			}),
		).toBe("WebGL (software)");
	});
});
