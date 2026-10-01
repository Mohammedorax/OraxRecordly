import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	cancelForwardFrameSourceMock,
	destroyForwardFrameSourceMock,
	getForwardFrameAtTimeMock,
	initializeForwardFrameSourceMock,
	pixiApplicationInstancesMock,
	pixiInitializationErrorsMock,
	resolveMediaElementSourceMock,
} = vi.hoisted(() => ({
	cancelForwardFrameSourceMock: vi.fn(),
	destroyForwardFrameSourceMock: vi.fn(async () => undefined),
	getForwardFrameAtTimeMock: vi.fn(async () => null),
	initializeForwardFrameSourceMock: vi.fn(async () => undefined),
	pixiApplicationInstancesMock: [] as Array<{
		destroy: ReturnType<typeof vi.fn>;
		init: ReturnType<typeof vi.fn>;
		renderer: { destroy: ReturnType<typeof vi.fn> };
		stage: { destroy: ReturnType<typeof vi.fn> };
	}>,
	pixiInitializationErrorsMock: [] as Array<Error | undefined>,
	resolveMediaElementSourceMock: vi.fn(async () => ({
		src: "blob:background",
		revoke: vi.fn(),
	})),
}));

vi.mock("pixi.js", () => ({
	Application: class {
		destroy = vi.fn(() => {
			throw new TypeError("this._cancelResize is not a function");
		});
		init = vi.fn(async () => {
			const error = pixiInitializationErrorsMock.shift();
			if (error) throw error;
		});
		renderer = { destroy: vi.fn() };
		stage = { destroy: vi.fn() };

		constructor() {
			pixiApplicationInstancesMock.push(this);
		}
	},
	BlurFilter: class {},
	Container: class {
		visible = true;
		addChild = vi.fn();
		addChildAt = vi.fn();
		removeChildren = vi.fn();
	},
	Graphics: class {},
	Sprite: class {
		visible = true;
		x = 0;
		y = 0;
		alpha = 1;
		scale = { x: 1, y: 1, set: vi.fn() };
		anchor = { x: 0.5, y: 0.5, set: vi.fn() };
		position = { set: vi.fn() };
		texture: { destroy: ReturnType<typeof vi.fn> };

		constructor(texture = { destroy: vi.fn() }) {
			this.texture = texture;
		}
	},
	Texture: {
		from: vi.fn(() => ({ source: { update: vi.fn() }, destroy: vi.fn() })),
	},
}));

vi.mock("pixi-filters/motion-blur", () => ({
	MotionBlurFilter: class {},
}));

vi.mock("@/lib/assetPath", () => ({
	getAssetPath: vi.fn(async (value: string) => value),
	getExportableVideoUrl: vi.fn(async (value: string) => value),
	getRenderableAssetUrl: vi.fn((value: string) => value),
}));

vi.mock("@/components/video-editor/videoPlayback/zoomRegionUtils", () => ({
	findDominantRegion: vi.fn(() => ({
		region: null,
		strength: 0,
		blendedScale: 1,
		transition: null,
	})),
}));

vi.mock("@/components/video-editor/videoPlayback/zoomTransform", () => ({
	applyZoomTransform: vi.fn(),
	computeFocusFromTransform: vi.fn(() => ({ cx: 0.5, cy: 0.5 })),
	computeZoomTransform: vi.fn(() => ({ scale: 1, x: 0, y: 0 })),
	createMotionBlurState: vi.fn(() => ({})),
}));

vi.mock("@/components/video-editor/videoPlayback/cursorRenderer", () => ({
	PixiCursorOverlay: class {
		container = {};
		update = vi.fn();
		destroy = vi.fn();
	},
	DEFAULT_CURSOR_CONFIG: {
		dotRadius: 28,
		smoothingFactor: 0.18,
		motionBlur: 0,
		clickBounce: 1,
		sway: 0,
	},
	preloadCursorAssets: vi.fn(async () => undefined),
}));

vi.mock("./forwardFrameSource", () => ({
	ForwardFrameSource: class {
		cancel = cancelForwardFrameSourceMock;
		destroy = destroyForwardFrameSourceMock;
		getFrameAtTime = getForwardFrameAtTimeMock;
		initialize = initializeForwardFrameSourceMock;
	},
}));

vi.mock("./localMediaSource", () => ({
	resolveMediaElementSource: resolveMediaElementSourceMock,
}));

vi.mock("./annotationRenderer", () => ({
	preloadAnnotationAssets: vi.fn(async () => ({ imageCache: new Map() })),
	renderAnnotationToCanvas: vi.fn(async () => null),
	renderAnnotations: vi.fn(async () => undefined),
}));

import { renderAnnotations } from "./annotationRenderer";
import { FrameRenderer } from "./modernFrameRenderer";

function createMockContext() {
	return {
		clearRect: vi.fn(),
		drawImage: vi.fn(),
		fillRect: vi.fn(),
		save: vi.fn(),
		restore: vi.fn(),
		getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(0) })),
		globalAlpha: 1,
		imageSmoothingEnabled: true,
		imageSmoothingQuality: "high",
	} as unknown as CanvasRenderingContext2D;
}

function createMockCanvas() {
	const context = createMockContext();
	return {
		width: 0,
		height: 0,
		getContext: vi.fn(() => context),
		context,
	};
}

function createRenderer() {
	return new FrameRenderer({
		width: 1920,
		height: 1080,
		nativeReadbackMode: "pixels",
		wallpaper: "#000000",
		zoomRegions: [],
		showShadow: false,
		shadowIntensity: 0,
		backgroundBlur: 0,
		cropRegion: { x: 0, y: 0, width: 1, height: 1 },
		videoWidth: 1920,
		videoHeight: 1080,
		annotationRegions: [
			{
				id: "blur-1",
				startMs: 0,
				endMs: 1000,
				type: "blur",
				content: "",
				position: { x: 10, y: 10 },
				size: { width: 20, height: 20 },
				style: {
					color: "#ffffff",
					backgroundColor: "transparent",
					fontSize: 24,
					fontFamily: "Inter",
					fontWeight: "normal",
					fontStyle: "normal",
					textDecoration: "none",
					textAlign: "center",
					borderRadius: 0,
				},
				zIndex: 1,
				blurIntensity: 20,
			},
		],
	});
}

it("bypasses blur annotation compositing during gaps and clears stale composite frames", async () => {
	const renderer = createRenderer();
	const camera = { visible: true };
	const canvas = createMockCanvas();
	const render = vi.fn();
	const compose = vi.fn();
	const captions = { visible: true };
	Object.assign(renderer, {
		app: { canvas, render },
		videoContainer: {},
		videoMaskGraphics: {},
		cameraContainer: camera,
		captionContainer: captions,
		hasActiveBlurAnnotations: () => true,
		composeBlurAnnotationFrame: compose,
		outputCanvasOverride: createMockCanvas(),
	});
	await renderer.renderFrame(null, 0, 0, 33333, 1500000);
	expect(camera.visible).toBe(false);
	expect(captions.visible).toBe(false);
	expect(compose).not.toHaveBeenCalled();
	expect(render).toHaveBeenCalledOnce();
	expect(renderer.getCanvas()).toBe(canvas);
});

describe("ModernFrameRenderer Pixi lifecycle", () => {
	it("continues to the next backend when failed-init cleanup would throw", async () => {
		pixiApplicationInstancesMock.length = 0;
		pixiInitializationErrorsMock.length = 0;
		pixiInitializationErrorsMock.push(new Error("WebGPU initialization failed"), undefined);
		vi.stubGlobal("navigator", { gpu: {} });

		try {
			const renderer = createRenderer() as unknown as {
				config: { preferredRenderBackend?: "webgl" | "webgpu" };
				createPixiApplication: (
					canvas: HTMLCanvasElement,
				) => Promise<{ backend: "webgl" | "webgpu" }>;
			};
			renderer.config.preferredRenderBackend = "webgpu";

			await expect(
				renderer.createPixiApplication({} as HTMLCanvasElement),
			).resolves.toMatchObject({
				backend: "webgl",
			});

			expect(pixiApplicationInstancesMock).toHaveLength(2);
			expect(pixiApplicationInstancesMock[0].destroy).not.toHaveBeenCalled();
			expect(pixiApplicationInstancesMock[0].stage.destroy).toHaveBeenCalledTimes(1);
			expect(pixiApplicationInstancesMock[0].renderer.destroy).toHaveBeenCalledTimes(1);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe("ModernFrameRenderer blur export path", () => {
	beforeEach(() => {
		Object.assign(globalThis, {
			window: globalThis,
			requestAnimationFrame: (callback: FrameRequestCallback) => {
				callback(0);
				return 1;
			},
			cancelAnimationFrame: vi.fn(),
			HTMLMediaElement: {
				HAVE_CURRENT_DATA: 2,
			},
			document: {
				createElement: vi.fn((tag: string) => {
					if (tag === "video") {
						return {
							duration: 5,
							readyState: 2,
							videoWidth: 1280,
							videoHeight: 720,
							muted: true,
							loop: true,
							playsInline: true,
							preload: "auto",
							src: "",
							currentTime: 0,
							load: vi.fn(),
							pause: vi.fn(),
							addEventListener: vi.fn(),
							removeEventListener: vi.fn(),
						};
					}
					if (tag !== "canvas") {
						throw new Error(`Unexpected element requested in test: ${tag}`);
					}

					return createMockCanvas();
				}),
			},
		});
	});

	it("uses a composited canvas and disables pixel readback when blur post-processing is active", async () => {
		const renderer = createRenderer() as any;
		const sourceCanvas = createMockCanvas();

		renderer.app = { canvas: sourceCanvas };
		renderer.annotationScaleFactor = 1;
		renderer.annotationAssets = { imageCache: new Map() };

		await renderer.composeBlurAnnotationFrame(500);

		expect(renderAnnotations).toHaveBeenCalledTimes(1);
		expect(renderer.getCanvas()).not.toBe(sourceCanvas);
		expect(renderer.capturePixelsForNativeExport()).not.toBeNull();
	});

	it("prefers decoder-backed sync for video wallpapers during export", async () => {
		vi.clearAllMocks();
		const renderer = new FrameRenderer({
			width: 1920,
			height: 1080,
			nativeReadbackMode: "pixels",
			wallpaper: "/wallpapers/wispysky.mp4",
			zoomRegions: [],
			showShadow: false,
			shadowIntensity: 0,
			backgroundBlur: 0,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			videoWidth: 1920,
			videoHeight: 1080,
		}) as any;

		await renderer.setupBackground();

		expect(initializeForwardFrameSourceMock).toHaveBeenCalledWith("wallpapers/wispysky.mp4");
		expect(resolveMediaElementSourceMock).not.toHaveBeenCalled();
		expect(renderer.backgroundForwardFrameSource).toBeTruthy();
		expect(renderer.backgroundVideoElement).toBeNull();
	});

	it("falls back to media-element sync when video wallpaper packet streaming fails", async () => {
		vi.clearAllMocks();
		initializeForwardFrameSourceMock.mockResolvedValue(undefined);
		getForwardFrameAtTimeMock.mockRejectedValueOnce(
			new Error("readAVPacket pipeline failed: Failed after 3 attempts"),
		);
		resolveMediaElementSourceMock.mockResolvedValueOnce({
			src: "blob:background-video",
			revoke: vi.fn(),
		});
		const renderer = new FrameRenderer({
			width: 1920,
			height: 1080,
			nativeReadbackMode: "pixels",
			wallpaper: "/wallpapers/wispysky.mp4",
			zoomRegions: [],
			showShadow: false,
			shadowIntensity: 0,
			backgroundBlur: 0,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			videoWidth: 1920,
			videoHeight: 1080,
		}) as any;

		await renderer.setupBackground();
		await expect(renderer.syncBackgroundFrame(1)).resolves.toBeUndefined();

		expect(cancelForwardFrameSourceMock).toHaveBeenCalled();
		expect(destroyForwardFrameSourceMock).toHaveBeenCalled();
		expect(resolveMediaElementSourceMock).toHaveBeenCalledWith("wallpapers/wispysky.mp4");
		expect(renderer.backgroundForwardFrameSource).toBeNull();
		expect(renderer.backgroundVideoElement).toBeTruthy();
	});
});

describe("ModernFrameRenderer frame sequencing", () => {
	it("resumes visual layers after a background gap", async () => {
		const renderer = createRenderer();
		const sceneCanvas = createMockCanvas();
		const gapCanvas = createMockCanvas();
		gapCanvas.width = 1920;
		gapCanvas.height = 1080;
		const render = vi.fn();
		const syncBackground = vi.fn();
		const updateAnnotations = vi.fn();
		const updateCaptions = vi.fn();
		const updateAnimation = vi.fn();
		const camera = { visible: true };
		Object.assign(renderer, {
			config: {
				width: 1920,
				height: 1080,
				timelineEffects: true,
				zoomMotionBlur: 0.5,
			},
			app: { canvas: sceneCanvas, render },
			videoContainer: {},
			videoMaskGraphics: {},
			cameraContainer: camera,
			videoSprite: {},
			videoTextureSource: { update: vi.fn() },
			layoutCache: {
				stageSize: { width: 1920, height: 1080 },
				maskRect: { x: 0, y: 0, width: 1920, height: 1080 },
			},
			resolveDetachedVideoFrameSource: async (frame: VideoFrame) => frame,
			ensureExportCompositeCanvas: () => ({ canvas: gapCanvas, context: gapCanvas.context }),
			backgroundForwardFrameSource: {},
			syncBackgroundFrame: syncBackground,
			updateAnimationState: updateAnimation,
			updateAnnotationLayer: updateAnnotations,
			updateCaptionLayer: updateCaptions,
		});
		await renderer.renderFrame({} as VideoFrame, 0, 0, 33_333, 0);
		expect(renderer.getCanvas()).toBe(sceneCanvas);

		await renderer.renderFrame(null, 0, 0, 33_333, 1_500_000);
		expect(updateAnimation).toHaveBeenLastCalledWith(1500, 0);
		expect(renderer.getCanvas()).toBe(sceneCanvas);
		expect(render).toHaveBeenCalledTimes(2);
		expect(syncBackground).toHaveBeenCalledTimes(2);
		expect(camera.visible).toBe(false);
		for (const callback of [updateAnnotations, updateCaptions]) {
			expect(callback).toHaveBeenCalledTimes(1);
		}

		await renderer.renderFrame({} as VideoFrame, 6_000_000, 6_000_000, 33_333, 2_000_000);
		expect(renderer.getCanvas()).toBe(sceneCanvas);
		expect(camera.visible).toBe(true);
		expect(render).toHaveBeenCalledTimes(3);
		expect(syncBackground).toHaveBeenLastCalledWith(2);
		expect(updateAnnotations).toHaveBeenLastCalledWith(2000);
		expect(updateCaptions).toHaveBeenLastCalledWith(6000);
	});
});
