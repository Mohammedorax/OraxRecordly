import { Container, Sprite, Texture } from "pixi.js";
import {
	DEFAULT_KEYCAST_SETTINGS,
	type KeycastKeystroke,
	type KeycastSettings,
	normalizeKeycastKeystrokes,
	normalizeKeycastSettings,
} from "@/lib/keycast/keycastModel";
import {
	detectMacPlatform,
	paintKeycastBadge,
	planKeycastBadge,
} from "@/lib/keycast/keycastRenderer";

export interface KeycastOverlayLayerConfig {
	width: number;
	height: number;
	events?: readonly KeycastKeystroke[];
	settings?: Partial<KeycastSettings>;
	/** Overrides platform detection; used by tests and native-ish hosts. */
	isMac?: boolean;
}

type MutableTextureSource = {
	resource: CanvasImageSource;
	update: () => void;
};

/**
 * Pixi layer that burns the keystroke badge into an exported frame.
 *
 * The layer mirrors how captions are rendered at export: a badge-sized canvas
 * is rasterised only when the badge content, size or fade step changes, then
 * uploaded as one sprite texture. Frame-rate playback therefore costs a
 * position update per frame and a full rasterise only on an actual keystroke or
 * during the short fade.
 */
export class KeycastOverlayLayer {
	private readonly container: Container;
	private readonly config: KeycastOverlayLayerConfig;
	private readonly events: KeycastKeystroke[];
	private readonly settings: KeycastSettings;
	private readonly measureCanvas: HTMLCanvasElement | null;
	private readonly measureCtx: CanvasRenderingContext2D | null;
	private canvas: HTMLCanvasElement | null = null;
	private ctx: CanvasRenderingContext2D | null = null;
	private sprite: Sprite | null = null;
	private textureSource: MutableTextureSource | null = null;
	private lastPlanKey: string | null = null;

	constructor(parent: Container, config: KeycastOverlayLayerConfig) {
		this.container = new Container();
		this.container.label = "keycast-overlay";
		this.container.visible = false;
		parent.addChild(this.container);
		this.config = config;
		// Normalise once: `update` runs on every exported frame, and sorting or
		// coalescing the whole recording per frame would cost the export real time.
		this.events = normalizeKeycastKeystrokes(config.events ?? []);
		this.settings = normalizeKeycastSettings({
			...DEFAULT_KEYCAST_SETTINGS,
			...config.settings,
		});

		if (typeof document === "undefined") {
			this.measureCanvas = null;
			this.measureCtx = null;
			return;
		}

		this.measureCanvas = document.createElement("canvas");
		this.measureCanvas.width = 1;
		this.measureCanvas.height = 1;
		this.measureCtx = this.measureCanvas.getContext("2d");
	}

	/** Hide the badge for one frame (gap frames have no content to draw over). */
	hide(): void {
		this.container.visible = false;
		this.lastPlanKey = null;
	}

	private ensureCanvas(width: number, height: number): void {
		const targetWidth = Math.max(1, Math.ceil(width));
		const targetHeight = Math.max(1, Math.ceil(height));

		if (
			this.canvas &&
			this.canvas.width === targetWidth &&
			this.canvas.height === targetHeight &&
			this.ctx &&
			this.sprite
		) {
			return;
		}

		const canvas = document.createElement("canvas");
		canvas.width = targetWidth;
		canvas.height = targetHeight;
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			return;
		}

		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = "high";
		this.canvas = canvas;
		this.ctx = ctx;

		const nextTexture = Texture.from(canvas);
		if (this.sprite) {
			const previousTexture = this.sprite.texture;
			this.sprite.texture = nextTexture;
			this.textureSource = nextTexture.source as unknown as MutableTextureSource;
			previousTexture.destroy(true);
		} else {
			this.sprite = new Sprite(nextTexture);
			this.sprite.anchor.set(0);
			this.container.addChild(this.sprite);
			this.textureSource = nextTexture.source as unknown as MutableTextureSource;
		}
	}

	/** Compose the badge for one frame. Safe to call for every exported frame. */
	update(timeMs: number): void {
		const settings = this.settings;
		if (
			!settings.enabled ||
			this.events.length === 0 ||
			!this.measureCtx ||
			this.config.width <= 0 ||
			this.config.height <= 0
		) {
			this.hide();
			return;
		}

		const plan = planKeycastBadge(this.measureCtx, {
			events: this.events,
			settings,
			width: this.config.width,
			height: this.config.height,
			timeMs,
			isMac: this.config.isMac ?? detectMacPlatform(),
		});
		if (!plan) {
			this.hide();
			return;
		}

		if (plan.key !== this.lastPlanKey || !this.canvas || !this.ctx || !this.sprite) {
			this.ensureCanvas(plan.boxWidth, plan.boxHeight);
			if (!this.ctx || !this.canvas || !this.sprite) {
				this.container.visible = false;
				return;
			}

			this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
			this.ctx.save();
			// The plan is expressed in frame coordinates; the canvas only covers
			// the badge, so shift the badge's plate origin onto the canvas origin.
			this.ctx.translate(-plan.origin.x, -plan.origin.y);
			paintKeycastBadge(this.ctx, plan);
			this.ctx.restore();
			this.textureSource?.update();
			this.lastPlanKey = plan.key;
		}

		this.sprite.position.set(Math.round(plan.origin.x), Math.round(plan.origin.y));
		this.container.visible = true;
	}

	get texture(): Texture | null {
		return this.sprite?.texture ?? null;
	}

	destroy(): void {
		this.sprite = null;
		this.textureSource = null;
		this.ctx = null;
		this.canvas = null;
		// Textures are released by the owning renderer, which already collects
		// every sprite texture it has to destroy.
		this.container.destroy({ children: true });
	}
}
