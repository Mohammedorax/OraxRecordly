export interface HudOverlayWorkArea {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Stable screen position of the HUD box.
 *
 * The HUD keeps a constant size for its whole lifetime, so the anchor is only
 * used to remember where the user dragged the bar: the bottom edge is preserved
 * and clamped to the work area.
 */
export interface HudOverlayAnchor {
	/** Left edge of the HUD box in screen coordinates. */
	x: number;
	/** Bottom edge of the HUD box in screen coordinates. */
	bottom: number;
}

export interface HudOverlayBoundsOptions {
	/** User position; omitted while the HUD sits at its default bottom-center spot. */
	anchor?: HudOverlayAnchor | null;
}

const HUD_WIDTH_DIP = 860;

/**
 * Fixed HUD box height.
 *
 * The box never resizes at runtime. `BrowserWindow.setBounds()` on a
 * `transparent: true` always-on-top window re-creates the layered surface and
 * resizes the renderer viewport (re-laying out the bottom-anchored bar) — far
 * too expensive to run on every hover/popover transition. Every part of the box
 * that is not the bar is fully transparent *and* click-through through the
 * renderer-driven mouse passthrough, so a permanently tall box costs nothing;
 * 540 DIP is the height the {@link HudPopover} menus need to open above the bar.
 */
const HUD_HEIGHT_DIP = 540;

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), Math.max(min, max));
}

export function getHudOverlayAnchor(bounds: HudOverlayWorkArea): HudOverlayAnchor {
	return { x: bounds.x, bottom: bounds.y + bounds.height };
}

/**
 * Bounds for the HUD window.
 *
 * The HUD is a compact box the size of the recording bar instead of a
 * desktop-sized layered surface: a full-work-area always-on-top transparent
 * window forces DWM to alpha-blend the whole monitor. Transparent parts of the
 * box stay click-through through the renderer-driven mouse passthrough.
 */
export function getHudOverlayWindowBounds(
	workArea: HudOverlayWorkArea,
	{ anchor = null }: HudOverlayBoundsOptions = {},
): HudOverlayWorkArea {
	const width = Math.min(workArea.width, HUD_WIDTH_DIP);
	const height = Math.min(workArea.height, HUD_HEIGHT_DIP);
	const maxX = workArea.x + workArea.width - width;
	const maxY = workArea.y + workArea.height - height;
	const bottom = anchor
		? clamp(anchor.bottom, workArea.y + height, workArea.y + workArea.height)
		: workArea.y + workArea.height;
	const x = anchor
		? clamp(anchor.x, workArea.x, maxX)
		: Math.round(workArea.x + (workArea.width - width) / 2);

	return {
		x,
		y: clamp(bottom - height, workArea.y, maxY),
		width,
		height,
	};
}
