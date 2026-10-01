import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	cancelForwardFrameSourceMock,
	destroyForwardFrameSourceMock,
	getForwardFrameAtTimeMock,
	initializeForwardFrameSourceMock,
	resolveMediaElementSourceMock,
} = vi.hoisted(() => ({
	cancelForwardFrameSourceMock: vi.fn(),
	destroyForwardFrameSourceMock: vi.fn(async () => undefined),
	getForwardFrameAtTimeMock: vi.fn(async () => null),
	initializeForwardFrameSourceMock: vi.fn(async () => undefined),
	resolveMediaElementSourceMock: vi.fn(async () => ({
		src: "blob:background",
		revoke: vi.fn(),
	})),
}));

vi.mock("pixi.js", () => ({
	Application: vi.fn(),
	Container: vi.fn(),
	Sprite: vi.fn(),
	Graphics: vi.fn(),
	BlurFilter: vi.fn(),
	Texture: {
		from: vi.fn(() => ({ destroy: vi.fn() })),
	},
}));

vi.mock("pixi-filters/motion-blur", () => ({
	MotionBlurFilter: vi.fn(),
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

vi.mock("./annotationRenderer", () => ({
	renderAnnotations: vi.fn(),
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

import { FrameRenderer } from "./frameRenderer";

const rendererSource = readFileSync(
	fileURLToPath(new URL("./frameRenderer.ts", import.meta.url)),
	"utf8",
);

type MockCanvas = ReturnType<typeof createMockCanvas>;

describe("FrameRenderer mask hierarchy", () => {
	it("keeps the mask in the video wrapper when camera transforms change", () => {
		expect(rendererSource).toContain(
			"this.cameraContainer.addChild(this.videoEffectsContainer)",
		);
		expect(rendererSource).toContain("this.videoEffectsContainer.addChild(this.maskGraphics)");
		expect(rendererSource).not.toContain("this.cameraContainer.addChild(this.maskGraphics)");
	});
});

type Listener = {
	callback: () => void;
	once: boolean;
};

class FakeVideoElement {
	duration: number;
	readyState: number;
	seeking = false;
	videoWidth: number;
	videoHeight: number;
	muted = true;
	preload = "auto";
	playsInline = true;
	src = "";

	private currentTimeValue: number;
	private listeners = new Map<string, Listener[]>();

	constructor({
		duration = 5,
		currentTime = 0,
		readyState = 2,
		videoWidth = 1280,
		videoHeight = 720,
	}: {
		duration?: number;
		currentTime?: number;
		readyState?: number;
		videoWidth?: number;
		videoHeight?: number;
	} = {}) {
		this.duration = duration;
		this.currentTimeValue = currentTime;
		this.readyState = readyState;
		this.videoWidth = videoWidth;
		this.videoHeight = videoHeight;
	}

	get currentTime() {
		return this.currentTimeValue;
	}

	set currentTime(next: number) {
		this.currentTimeValue = next;
		this.seeking = true;
		queueMicrotask(() => {
			this.seeking = false;
			this.dispatch("seeked");
		});
	}

	addEventListener(
		name: string,
		callback: () => void,
		options?: boolean | AddEventListenerOptions,
	) {
		const listeners = this.listeners.get(name) ?? [];
		listeners.push({
			callback,
			once: !!(typeof options === "object" && options?.once),
		});
		this.listeners.set(name, listeners);
	}

	removeEventListener(name: string, callback: () => void) {
		const listeners = this.listeners.get(name) ?? [];
		this.listeners.set(
			name,
			listeners.filter((listener) => listener.callback !== callback),
		);
	}

	load() {
		// Intentional no-op for the mock video element.
	}

	pause() {
		// Intentional no-op for the mock video element.
	}

	private dispatch(name: string) {
		const listeners = [...(this.listeners.get(name) ?? [])];
		if (listeners.length === 0) {
			return;
		}

		for (const listener of listeners) {
			listener.callback();
			if (listener.once) {
				this.removeEventListener(name, listener.callback);
			}
		}
	}
}

function createMockContext() {
	return {
		beginPath: vi.fn(),
		moveTo: vi.fn(),
		lineTo: vi.fn(),
		closePath: vi.fn(),
		clip: vi.fn(),
		drawImage: vi.fn(),
		fillRect: vi.fn(),
		save: vi.fn(),
		restore: vi.fn(),
		translate: vi.fn(),
		scale: vi.fn(),
		clearRect: vi.fn(),
		filter: "",
		fillStyle: "",
	};
}

function createMockCanvas() {
	const context = createMockContext();
	return {
		width: 0,
		height: 0,
		context,
		getContext: vi.fn((_type?: string) => context as unknown as CanvasRenderingContext2D),
	};
}

function createRenderer() {
	return new FrameRenderer({
		width: 1920,
		height: 1080,
		wallpaper: "#000000",
		zoomRegions: [],
		showShadow: false,
		shadowIntensity: 0,
		backgroundBlur: 0,
		cropRegion: { x: 0, y: 0, width: 1, height: 1 },
		videoWidth: 1920,
		videoHeight: 1080,
	});
}

describe("FrameRenderer export path", () => {
	it("composites the background during a gap without source layers", async () => {
		const renderer = createRenderer();
		const camera = { visible: true };
		const context = createMockContext();
		const app = { stage: {}, renderer: { render: vi.fn() } };
		const composite = vi.fn();
		Object.assign(renderer, {
			app,
			cameraContainer: camera,
			videoContainer: {},
			compositeCtx: context,
			compositeWithShadows: composite,
		});
		await renderer.renderFrame(null, 0, 0, 33333, 1500000);
		expect(camera.visible).toBe(false);
		expect(app.renderer.render).toHaveBeenCalledWith(app.stage);
		expect(composite).toHaveBeenCalledWith();
	});

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
						return new FakeVideoElement();
					}
					if (tag !== "canvas") {
						throw new Error(`Unexpected element requested in test: ${tag}`);
					}

					const canvas = createMockCanvas();
					return canvas;
				}),
			},
		});
	});

	it("prefers decoder-backed sync for video wallpapers during export", async () => {
		vi.clearAllMocks();
		const renderer = new FrameRenderer({
			width: 1920,
			height: 1080,
			wallpaper: "/wallpapers/wispysky.mp4",
			zoomRegions: [],
			showShadow: false,
			shadowIntensity: 0,
			backgroundBlur: 0,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			videoWidth: 1920,
			videoHeight: 1080,
		}) as unknown as {
			setupBackground: () => Promise<void>;
			backgroundForwardFrameSource: unknown;
			backgroundVideoElement: FakeVideoElement | null;
			backgroundSprite: MockCanvas | null;
		};

		await renderer.setupBackground();

		expect(initializeForwardFrameSourceMock).toHaveBeenCalledWith("wallpapers/wispysky.mp4");
		expect(resolveMediaElementSourceMock).not.toHaveBeenCalled();
		expect(renderer.backgroundForwardFrameSource).toBeTruthy();
		expect(renderer.backgroundVideoElement).toBeNull();
		expect(renderer.backgroundSprite).toBeTruthy();
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
			wallpaper: "/wallpapers/wispysky.mp4",
			zoomRegions: [],
			showShadow: false,
			shadowIntensity: 0,
			backgroundBlur: 0,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			videoWidth: 1920,
			videoHeight: 1080,
		}) as unknown as {
			setupBackground: () => Promise<void>;
			syncBackgroundFrame: (timeSeconds: number) => Promise<void>;
			backgroundForwardFrameSource: unknown;
			backgroundVideoElement: FakeVideoElement | null;
		};

		await renderer.setupBackground();
		await expect(renderer.syncBackgroundFrame(1)).resolves.toBeUndefined();

		expect(cancelForwardFrameSourceMock).toHaveBeenCalled();
		expect(destroyForwardFrameSourceMock).toHaveBeenCalled();
		expect(resolveMediaElementSourceMock).toHaveBeenCalledWith("wallpapers/wispysky.mp4");
		expect(renderer.backgroundForwardFrameSource).toBeNull();
		expect(renderer.backgroundVideoElement).toBeTruthy();
	});
});
