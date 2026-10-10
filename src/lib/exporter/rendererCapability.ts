/**
 * Renderer capability probe for the export pipeline.
 *
 * Both export pipelines draw through Pixi (WebGL/WebGPU). When neither context
 * can be created the export cannot run at all, and the user deserves to know
 * before a render starts rather than after a minute of decoding. The probe also
 * feeds the diagnostic log, so a support report shows what the machine offered.
 */

export type ExportRendererCapability = {
	webgl: boolean;
	webgpu: boolean;
	/** True when a hardware-accelerated context could be created. */
	hardwareAccelerated: boolean;
};

type ProbeDocument = Pick<Document, "createElement">;

function probeWebgl(canvas: HTMLCanvasElement): boolean {
	try {
		const context =
			canvas.getContext("webgl2") ??
			canvas.getContext("webgl") ??
			canvas.getContext("experimental-webgl");
		return Boolean(context);
	} catch {
		return false;
	}
}

function probeWebgpu(navigatorLike: Navigator): boolean {
	try {
		return typeof (navigatorLike as { gpu?: unknown }).gpu !== "undefined";
	} catch {
		return false;
	}
}

/** Reads the WebGL renderer string, which reveals software rasterizers. */
function readRendererName(canvas: HTMLCanvasElement): string {
	try {
		const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
		if (!context) {
			return "";
		}
		const gl = context as WebGLRenderingContext;
		const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
		const unmasked = debugInfo
			? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
			: gl.getParameter(gl.RENDERER);
		return typeof unmasked === "string" ? unmasked : "";
	} catch {
		return "";
	}
}

/**
 * Probes the current runtime. Never throws: an unavailable document (a unit
 * test) simply reports no support.
 */
export function detectExportRendererCapability(environment?: {
	document?: ProbeDocument;
	navigator?: Navigator;
}): ExportRendererCapability {
	const doc = environment?.document ?? (typeof document !== "undefined" ? document : undefined);
	const nav =
		environment?.navigator ?? (typeof navigator !== "undefined" ? navigator : undefined);

	if (!doc) {
		return { webgl: false, webgpu: false, hardwareAccelerated: false };
	}

	try {
		const canvas = doc.createElement("canvas") as HTMLCanvasElement;
		const webgl = probeWebgl(canvas);
		const rendererName = webgl ? readRendererName(canvas) : "";
		return {
			webgl,
			webgpu: nav ? probeWebgpu(nav) : false,
			hardwareAccelerated:
				webgl && !/swiftshader|software|basic render|llvmpipe|lavapipe/i.test(rendererName),
		};
	} catch {
		return { webgl: false, webgpu: false, hardwareAccelerated: false };
	}
}

export function describeExportRendererCapability(capability: ExportRendererCapability): string {
	if (!capability.webgl && !capability.webgpu) {
		return "no WebGL or WebGPU context (export needs one of them)";
	}
	const parts = [capability.webgl ? "WebGL" : null, capability.webgpu ? "WebGPU" : null].filter(
		Boolean,
	);
	return `${parts.join(" + ")}${capability.hardwareAccelerated ? "" : " (software)"}`;
}
