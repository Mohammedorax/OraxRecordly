import {
	buildKeycastBadgeMetrics,
	formatKeycastToken,
	type KeycastKeystroke,
	type KeycastSettings,
	resolveKeycastBadge,
	resolveKeycastBadgeOrigin,
} from "./keycastModel";

/**
 * Canvas renderer for the keystroke overlay.
 *
 * Export composites the badge with this function; the editor preview and the
 * recording HUD draw the same badge as DOM (see `KeycastBadge.tsx`) because
 * their overlays are already DOM-based, exactly like captions. Both readers
 * share `keycastModel.ts`, so timing and coalescing cannot drift.
 *
 * The badge is rasterised into a canvas the size of the badge itself (not the
 * whole frame) and positioned by its plate origin, so a keystroke costs one
 * small texture upload rather than a full-frame one.
 */

const KEYCAST_FONT_STACK =
	'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const PLATE_FILL = "rgba(15, 23, 42, 0.82)";
const PLATE_STROKE = "rgba(255, 255, 255, 0.22)";
const CAP_FILL = "#F8FAFC";
const CAP_EDGE = "#CBD5E1";
const CAP_TEXT = "#0F172A";
const SEPARATOR_TEXT = "rgba(226, 232, 240, 0.85)";

export interface KeycastRenderInput {
	events: readonly KeycastKeystroke[];
	settings: KeycastSettings;
	width: number;
	height: number;
	/** Source-timeline time in milliseconds. */
	timeMs: number;
	isMac: boolean;
}

export interface KeycastBadgePlan {
	labels: string[];
	capWidths: number[];
	boxWidth: number;
	boxHeight: number;
	/** Top-left of the plate in frame coordinates. */
	origin: { x: number; y: number };
	capHeight: number;
	capRadius: number;
	separatorWidth: number;
	paddingX: number;
	paddingY: number;
	fontSize: number;
	scale: number;
	opacity: number;
	/** Small cache key: identical plans can reuse the rasterised texture. */
	key: string;
}

/** Whether the running renderer is macOS (modifier glyphs follow the OS). */
export function detectMacPlatform(): boolean {
	if (typeof navigator === "undefined") {
		return false;
	}

	const candidate = navigator as Navigator & { userAgentData?: { platform?: string } };
	const source = candidate.userAgentData?.platform ?? navigator.platform ?? navigator.userAgent;
	return /mac|iphone|ipad|ipod/i.test(source ?? "");
}

function traceRoundedRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
	radius: number,
): void {
	const safeRadius = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
	ctx.beginPath();
	ctx.moveTo(x + safeRadius, y);
	ctx.lineTo(x + width - safeRadius, y);
	ctx.arcTo(x + width, y, x + width, y + safeRadius, safeRadius);
	ctx.lineTo(x + width, y + height - safeRadius);
	ctx.arcTo(x + width, y + height, x + width - safeRadius, y + height, safeRadius);
	ctx.lineTo(x + safeRadius, y + height);
	ctx.arcTo(x, y + height, x, y + height - safeRadius, safeRadius);
	ctx.lineTo(x, y + safeRadius);
	ctx.arcTo(x, y, x + safeRadius, y, safeRadius);
	ctx.closePath();
}

/**
 * Measure the badge for `timeMs` and place it inside the frame. Returns `null`
 * when the overlay is disabled or the badge has already faded out, so callers
 * can plan for every frame.
 */
export function planKeycastBadge(
	ctx: CanvasRenderingContext2D,
	input: KeycastRenderInput,
): KeycastBadgePlan | null {
	const { events, settings, width, height, timeMs, isMac } = input;
	if (!settings.enabled || width <= 0 || height <= 0) {
		return null;
	}

	const badge = resolveKeycastBadge(events, timeMs, { holdMs: settings.holdMs });
	if (!badge) {
		return null;
	}

	const metrics = buildKeycastBadgeMetrics(width, settings);
	const labels = badge.keys.map((key) => formatKeycastToken(key, isMac));

	ctx.save();
	ctx.direction = "ltr";
	ctx.font = `600 ${metrics.fontSize}px ${KEYCAST_FONT_STACK}`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";

	const capWidths = labels.map((label) =>
		Math.max(
			metrics.capHeight,
			Math.round(ctx.measureText(label).width + metrics.paddingX * 2),
		),
	);
	ctx.restore();

	const capsWidth = capWidths.reduce((total, capWidth) => total + capWidth, 0);
	const separatorsWidth = Math.max(0, labels.length - 1) * metrics.separatorWidth;
	const boxWidth = capsWidth + separatorsWidth + metrics.paddingX * 2;
	const boxHeight = metrics.capHeight + metrics.paddingY * 2;
	const origin = resolveKeycastBadgeOrigin(
		settings.position,
		width,
		height,
		boxWidth,
		boxHeight,
		metrics.margin,
	);

	return {
		labels,
		capWidths,
		boxWidth,
		boxHeight,
		origin,
		capHeight: metrics.capHeight,
		capRadius: metrics.capRadius,
		separatorWidth: metrics.separatorWidth,
		paddingX: metrics.paddingX,
		paddingY: metrics.paddingY,
		fontSize: metrics.fontSize,
		scale: metrics.scale,
		opacity: settings.opacity * badge.opacity,
		key: `${badge.keys.join("+")}|${settings.position}|${boxWidth}x${boxHeight}|${settings.opacity}|${Math.round(badge.opacity * 100)}|${isMac ? "mac" : "other"}`,
	};
}

/**
 * Paint a planned badge with the plate's top-left corner at `plan.origin`.
 * Callers that rasterise into a badge-sized canvas translate the context first.
 */
export function paintKeycastBadge(
	ctx: CanvasRenderingContext2D,
	plan: KeycastBadgePlan,
	opacityScale = 1,
): void {
	const { labels, capWidths, origin, capHeight, capRadius, separatorWidth } = plan;
	const alpha = Math.max(0, Math.min(1, plan.opacity * opacityScale));
	if (alpha <= 0 || labels.length === 0) {
		return;
	}

	ctx.save();
	ctx.direction = "ltr";
	ctx.font = `600 ${plan.fontSize}px ${KEYCAST_FONT_STACK}`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.globalAlpha = alpha;

	// Dark translucent plate keeps the caps legible over light and dark content
	// alike; the hairline border stops it dissolving into a dark background.
	traceRoundedRect(ctx, origin.x, origin.y, plan.boxWidth, plan.boxHeight, capHeight * 0.32);
	ctx.fillStyle = PLATE_FILL;
	ctx.fill();
	ctx.lineWidth = Math.max(1, plan.scale * 1.5);
	ctx.strokeStyle = PLATE_STROKE;
	ctx.stroke();

	const capY = origin.y + plan.paddingY;
	let cursorX = origin.x + plan.paddingX;

	labels.forEach((label, index) => {
		const capWidth = capWidths[index];
		traceRoundedRect(ctx, cursorX, capY, capWidth, capHeight, capRadius);
		ctx.fillStyle = CAP_FILL;
		ctx.fill();
		ctx.lineWidth = Math.max(1, plan.scale * 1.5);
		ctx.strokeStyle = CAP_EDGE;
		ctx.stroke();

		ctx.fillStyle = CAP_TEXT;
		ctx.fillText(label, cursorX + capWidth / 2, capY + capHeight / 2);

		cursorX += capWidth;
		if (index < labels.length - 1) {
			ctx.fillStyle = SEPARATOR_TEXT;
			ctx.fillText("+", cursorX + separatorWidth / 2, capY + capHeight / 2);
			cursorX += separatorWidth;
		}
	});

	ctx.restore();
}

/**
 * Convenience wrapper that draws into a context covering the whole frame.
 * Returns whether anything was painted.
 */
export function renderKeycastBadge(
	ctx: CanvasRenderingContext2D,
	input: KeycastRenderInput,
): boolean {
	const plan = planKeycastBadge(ctx, input);
	if (!plan) {
		return false;
	}

	paintKeycastBadge(ctx, plan);
	return true;
}
