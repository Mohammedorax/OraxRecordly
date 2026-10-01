/**
 * Pure geometry / history helpers for the lightweight screenshot image editor.
 *
 * Everything in this module is free of DOM access so it can be unit-tested in
 * the node vitest environment. The React component owns the canvases and calls
 * into these helpers for all coordinate math.
 */
/** Local numeric clamp: `@/lib/utils` only ships `cn`. */
export function clamp(value: number, low: number, high: number): number {
	if (!Number.isFinite(value)) return low;
	return Math.min(Math.max(value, low), high);
}

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };

export const MIN_CROP_SIZE = 8;
/** Upper bound on retained snapshots, one per committed edit. */
export const MAX_HISTORY = 30;

/* ------------------------------------------------------------------ *
 * Crop rectangle
 * ------------------------------------------------------------------ */

function orderedRect(a: Point, b: Point, bounds: Size): Rect {
	const left = clamp(Math.min(a.x, b.x), 0, bounds.width);
	const right = clamp(Math.max(a.x, b.x), 0, bounds.width);
	const top = clamp(Math.min(a.y, b.y), 0, bounds.height);
	const bottom = clamp(Math.max(a.y, b.y), 0, bounds.height);
	return {
		x: Math.round(left),
		y: Math.round(top),
		width: Math.round(right - left),
		height: Math.round(bottom - top),
	};
}

/** Normalize a freehand drag between two points into an in-bounds crop rect. */
export function cropRectFromDrag(start: Point, end: Point, bounds: Size): Rect {
	return orderedRect(start, end, bounds);
}

export type CropHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move";

/**
 * Resize (or move) a crop rectangle by dragging one of its handles. The moving
 * edge is clamped to the image, and the opposite edge is pinned so a drag past
 * it flips the rectangle instead of producing negative dimensions.
 */
export function resizeCropRect(
	rect: Rect,
	handle: CropHandle,
	point: Point,
	bounds: Size,
	minSize = MIN_CROP_SIZE,
): Rect {
	const left = rect.x;
	const top = rect.y;
	const right = rect.x + rect.width;
	const bottom = rect.y + rect.height;
	const x = clamp(point.x, 0, bounds.width);
	const y = clamp(point.y, 0, bounds.height);

	if (handle === "move") {
		const width = Math.min(rect.width, bounds.width);
		const height = Math.min(rect.height, bounds.height);
		const nx = clamp(rect.x + point.x, 0, Math.max(0, bounds.width - width));
		const ny = clamp(rect.y + point.y, 0, Math.max(0, bounds.height - height));
		return { x: Math.round(nx), y: Math.round(ny), width, height };
	}

	let nextLeft = left;
	let nextTop = top;
	let nextRight = right;
	let nextBottom = bottom;

	if (handle.includes("w")) {
		nextLeft = Math.min(x, right - minSize);
		nextRight = right;
	}
	if (handle.includes("e")) {
		nextRight = Math.max(x, left + minSize);
		nextLeft = left;
	}
	if (handle.includes("n")) {
		nextTop = Math.min(y, bottom - minSize);
		nextBottom = bottom;
	}
	if (handle.includes("s")) {
		nextBottom = Math.max(y, top + minSize);
		nextTop = top;
	}

	return {
		x: Math.round(nextLeft),
		y: Math.round(nextTop),
		width: Math.round(nextRight - nextLeft),
		height: Math.round(nextBottom - nextTop),
	};
}

/** True when the rectangle is big enough to be worth committing. */
export function isUsableCrop(rect: Rect, minSize = MIN_CROP_SIZE): boolean {
	return rect.width >= minSize && rect.height >= minSize;
}

/**
 * Whole-pixel rectangle of a region edit (crop / delete), forced inside the
 * image. The rect is normalized first, so a drag that ended left of or above
 * where it started still yields a positive rectangle; the result never extends
 * past the image and its edges land on integer pixel boundaries, which is what
 * `clearRect` and `drawImage` cut on. A region that lies entirely outside the
 * image collapses to a zero-sized rect and is rejected by `isUsableCrop`.
 */
export function clampRegionToImage(rect: Rect, bounds: Size): Rect {
	const left = clamp(Math.round(Math.min(rect.x, rect.x + rect.width)), 0, bounds.width);
	const top = clamp(Math.round(Math.min(rect.y, rect.y + rect.height)), 0, bounds.height);
	const right = clamp(Math.round(Math.max(rect.x, rect.x + rect.width)), 0, bounds.width);
	const bottom = clamp(Math.round(Math.max(rect.y, rect.y + rect.height)), 0, bounds.height);
	return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Handle measurement in CSS pixels. The chrome paints a `CROP_HANDLE_SIZE`
 * square on each anchor and `hitCropHandle` grabs within `CROP_HANDLE_SIZE` of
 * it, so the drawn handle and its grab area come from this one number and stay
 * centred on the same point at every zoom.
 */
export const CROP_HANDLE_SIZE = 9;

/** The eight resize handles, in hit-test precedence order (clockwise from nw). */
export const CROP_HANDLES: readonly CropHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/**
 * Handle anchor points in image space. Image space is a plain pixel grid whose
 * x grows to the right, so "w" is always the physically left edge regardless of
 * the document direction; the surface that draws them is pinned to LTR.
 */
export function cropHandleSpots(rect: Rect): Array<{ handle: CropHandle; point: Point }> {
	const right = rect.x + rect.width;
	const bottom = rect.y + rect.height;
	const midX = rect.x + rect.width / 2;
	const midY = rect.y + rect.height / 2;
	return [
		{ handle: "nw", point: { x: rect.x, y: rect.y } },
		{ handle: "n", point: { x: midX, y: rect.y } },
		{ handle: "ne", point: { x: right, y: rect.y } },
		{ handle: "e", point: { x: right, y: midY } },
		{ handle: "se", point: { x: right, y: bottom } },
		{ handle: "s", point: { x: midX, y: bottom } },
		{ handle: "sw", point: { x: rect.x, y: bottom } },
		{ handle: "w", point: { x: rect.x, y: midY } },
	];
}

/**
 * Which handle a point in image space grabs, `"move"` for the body, or `null`.
 * `scale` is CSS pixels per image pixel (`viewport.zoom`), so the grab reach is
 * `size` CSS pixels on screen — the very number `paintRegionOverlay` divides the
 * drawn handle by. Both sides therefore read one rect and one scale.
 */
export function hitCropHandle(
	point: Point,
	rect: Rect,
	scale: number,
	size = CROP_HANDLE_SIZE,
): CropHandle | null {
	const reach = size / (scale > 0 ? scale : 1);
	for (const { handle, point: spot } of cropHandleSpots(rect)) {
		if (Math.abs(point.x - spot.x) <= reach && Math.abs(point.y - spot.y) <= reach) {
			return handle;
		}
	}
	if (
		point.x >= rect.x &&
		point.x <= rect.x + rect.width &&
		point.y >= rect.y &&
		point.y <= rect.y + rect.height
	) {
		return "move";
	}
	return null;
}

/**
 * Distance in image pixels between the text box corner and the first glyph that
 * `commitText` paints. The inline editor pads its content by the same amount
 * (`textInset * zoom` CSS pixels) so the preview and the committed text agree.
 */
export function textInset(textSize: number): number {
	return Math.round(textSize * 0.25);
}

/* ------------------------------------------------------------------ *
 * Viewport (zoom / pan / high-DPI)
 * ------------------------------------------------------------------ */

export type Viewport = {
	/** devicePixelRatio used for the canvas backing store. */
	dpr: number;
	/**
	 * CSS size of the drawing surface the canvas elements are laid out in. It is
	 * measured from the canvas' own `getBoundingClientRect()`, so the backing
	 * store, the pointer origin and the DOM handles all share this one box.
	 */
	frameWidth: number;
	frameHeight: number;
	/** CSS pixels the image occupies on screen. */
	displayWidth: number;
	displayHeight: number;
	zoom: number;
	/** Top-left corner of the displayed image, in CSS pixels from the surface origin. */
	offsetX: number;
	offsetY: number;
	/**
	 * Canvas backing-store pixels per image pixel. It is exactly `dpr * zoom`:
	 * the render transform, the hit-test mapping and the DOM handles all read
	 * this single number, so a stroke can never be drawn at a scale the pointer
	 * path does not invert. The backing store itself is bounded by the surface
	 * size (not by the zoom), so magnifying is free and needs no cap.
	 */
	detailScale: number;
};

/** Zoom is bounded, and snaps to 1 so "100%" is always reachable. */
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;
export function clampZoom(zoom: number): number {
	return clamp(zoom, MIN_ZOOM, MAX_ZOOM);
}

/** Margin left free around a "fit to window" view, in CSS pixels. */
export const FIT_PADDING = 24;

/** Zoom that fits the whole image inside the viewport with a small margin. */
export function fitZoom(image: Size, viewport: Size, padding = FIT_PADDING): number {
	if (image.width <= 0 || image.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
		return 1;
	}
	const available = {
		width: Math.max(1, viewport.width - padding * 2),
		height: Math.max(1, viewport.height - padding * 2),
	};
	return clampZoom(Math.min(available.width / image.width, available.height / image.height));
}

/**
 * Pan offset that puts the displayed image in the middle of the viewport. The
 * offset is the image's top-left corner in CSS pixels, so the leftover space is
 * split evenly on both axes. `clampOffset` accepts this value both when the
 * image is smaller than the viewport (it is inside `[0, viewport - display]`)
 * and when it overflows (it is inside `[viewport - display - margin, margin]`),
 * so the centring survives `computeViewport`.
 */
export function centeredPan(image: Size, viewport: Size, zoom: number): Point {
	const scale = clampZoom(zoom);
	return {
		x: (viewport.width - image.width * scale) / 2,
		y: (viewport.height - image.height * scale) / 2,
	};
}

/** Zoom + pan of the initial view: whole image visible and centred. */
export function fitView(
	image: Size,
	viewport: Size,
	padding = FIT_PADDING,
): { zoom: number; pan: Point } {
	const zoom = fitZoom(image, viewport, padding);
	return { zoom, pan: centeredPan(image, viewport, zoom) };
}

/**
 * Pan offset that keeps the image point currently under the viewport centre
 * under the viewport centre after the viewport changes size. When the view is
 * already centred this re-centres it, so a resize never slides the picture off
 * to one side.
 */
export function panKeepingViewCenter(
	previous: { viewport: Size; zoom: number; pan: Point },
	viewport: Size,
): Point {
	const zoom = clampZoom(previous.zoom);
	const centre = {
		x: (previous.viewport.width / 2 - previous.pan.x) / zoom,
		y: (previous.viewport.height / 2 - previous.pan.y) / zoom,
	};
	return {
		x: viewport.width / 2 - centre.x * zoom,
		y: viewport.height / 2 - centre.y * zoom,
	};
}

/** Clamp the pan offset so at least a sliver of the image stays reachable. */
export function clampOffset(
	offset: number,
	displayLength: number,
	viewportLength: number,
	margin = 32,
): number {
	if (displayLength <= viewportLength) {
		return clamp(offset, 0, Math.max(0, viewportLength - displayLength));
	}
	return clamp(offset, viewportLength - displayLength - margin, margin);
}

export function computeViewport(
	image: Size,
	viewport: Size,
	zoom: number,
	pan: Point,
	dpr = 1,
): Viewport {
	const scale = clampZoom(zoom);
	const displayWidth = image.width * scale;
	const displayHeight = image.height * scale;
	const devicePixelRatio = dpr > 0 ? dpr : 1;
	return {
		dpr: devicePixelRatio,
		frameWidth: Math.max(0, viewport.width),
		frameHeight: Math.max(0, viewport.height),
		displayWidth,
		displayHeight,
		zoom: scale,
		offsetX: clampOffset(pan.x, displayWidth, viewport.width),
		offsetY: clampOffset(pan.y, displayHeight, viewport.height),
		detailScale: devicePixelRatio * scale,
	};
}

/**
 * Canvas backing-store size in device pixels. The surface is always the canvas'
 * own CSS box, so `backing === frame * dpr` and the bitmap is never resampled
 * by the browser: one canvas pixel is one device pixel, whatever the zoom.
 */
export function canvasBackingSize(viewport: Size, dpr: number): Size {
	const ratio = dpr > 0 ? dpr : 1;
	return {
		width: Math.max(1, Math.round(viewport.width * ratio)),
		height: Math.max(1, Math.round(viewport.height * ratio)),
	};
}

export function imageToScreen(point: Point, v: Viewport): Point {
	return { x: v.offsetX + point.x * v.zoom, y: v.offsetY + point.y * v.zoom };
}

export function screenToImage(point: Point, v: Viewport): Point {
	return { x: (point.x - v.offsetX) / v.zoom, y: (point.y - v.offsetY) / v.zoom };
}

/**
 * The transform that maps image space onto the canvas backing store. Rendering
 * applies it verbatim, so `imageToCanvas` below *is* the mapping the pixels are
 * drawn with and the hit-test path cannot drift away from the picture.
 */
export function canvasTransform(v: Viewport): [number, number, number, number, number, number] {
	return [v.detailScale, 0, 0, v.detailScale, v.dpr * v.offsetX, v.dpr * v.offsetY];
}

/** Image space -> canvas backing-store (device) pixels, through the render transform. */
export function imageToCanvas(point: Point, v: Viewport): Point {
	const t = canvasTransform(v);
	return { x: t[0] * point.x + t[4], y: t[3] * point.y + t[5] };
}

/** Canvas backing-store (device) pixels -> image space; the inverse of `canvasTransform`. */
export function canvasToImage(point: Point, v: Viewport): Point {
	const [a, b, c, d, e, f] = canvasTransform(v);
	const determinant = a * d - b * c;
	const dx = point.x - e;
	const dy = point.y - f;
	return {
		x: (d * dx - c * dy) / determinant,
		y: (a * dy - b * dx) / determinant,
	};
}

/** Zoom anchored on a screen point, so the pixel under the cursor stays put. */
export function zoomAroundPoint(nextZoom: number, anchorScreen: Point, v: Viewport): Point {
	const zoom = clampZoom(nextZoom);
	const anchorImage = screenToImage(anchorScreen, v);
	return {
		x: anchorScreen.x - anchorImage.x * zoom,
		y: anchorScreen.y - anchorImage.y * zoom,
	};
}

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

/** Angle in radians from `from` to `to` (screen space, y grows downward). */
export function arrowAngle(from: Point, to: Point): number {
	return Math.atan2(to.y - from.y, to.x - from.x);
}

/**
 * Solid triangular arrow head for the tip of an arrow, scaled to the stroke.
 * Returns an absolute-space triangle centred on `tip`.
 */
export function arrowHeadPoints(tip: Point, angle: number, strokeWidth: number): Point[] {
	const length = Math.max(12, strokeWidth * 4.5);
	const width = Math.max(9, strokeWidth * 3.2);
	const baseX = tip.x - Math.cos(angle) * length;
	const baseY = tip.y - Math.sin(angle) * length;
	const half = width / 2;
	const normalX = -Math.sin(angle) * half;
	const normalY = Math.cos(angle) * half;
	return [
		{ x: tip.x, y: tip.y },
		{ x: baseX + normalX, y: baseY + normalY },
		{ x: baseX - normalX, y: baseY - normalY },
	];
}

/** Axis-aligned ellipse parameters for the bounding box of a drag. */
export function ellipseFromDrag(start: Point, end: Point) {
	const x = Math.min(start.x, end.x);
	const y = Math.min(start.y, end.y);
	return {
		centerX: x + Math.abs(end.x - start.x) / 2,
		centerY: y + Math.abs(end.y - start.y) / 2,
		radiusX: Math.abs(end.x - start.x) / 2,
		radiusY: Math.abs(end.y - start.y) / 2,
	};
}

/**
 * Trace a pointer path as a smooth quadratic curve through the midpoints of
 * consecutive samples, which removes the angular look of raw pointer events.
 */
export function traceSmoothPath(ctx: CanvasRenderingContext2D, points: Point[]): void {
	if (points.length < 2) return;
	ctx.beginPath();
	ctx.moveTo(points[0].x, points[0].y);
	if (points.length === 2) {
		ctx.lineTo(points[1].x, points[1].y);
		return;
	}
	for (let index = 1; index < points.length - 1; index += 1) {
		const current = points[index];
		const next = points[index + 1];
		ctx.quadraticCurveTo(
			current.x,
			current.y,
			(current.x + next.x) / 2,
			(current.y + next.y) / 2,
		);
	}
	const last = points[points.length - 1];
	ctx.lineTo(last.x, last.y);
}

/** Drop samples that are closer than `minDistance` to the previous point. */
export function appendPoint(points: Point[], point: Point, minDistance = 1.5): Point[] {
	const previous = points[points.length - 1];
	if (previous) {
		const dx = point.x - previous.x;
		const dy = point.y - previous.y;
		if (Math.hypot(dx, dy) < minDistance) return points;
	}
	return [...points, point];
}

/* ------------------------------------------------------------------ *
 * Pixelate region
 * ------------------------------------------------------------------ */

/** Block size in image pixels: chunky enough to read as "redacted". */
export function pixelBlockSize(width: number, height: number, targetBlocks = 14): number {
	const longest = Math.max(width, height);
	if (longest <= 0) return 1;
	return Math.max(2, Math.round(longest / Math.max(2, targetBlocks)));
}

/**
 * Average each block of the sampled region. `source` is RGBA data for
 * `width * height` pixels; the returned data has the same dimensions.
 */
export function pixelateRegion(
	source: Uint8ClampedArray,
	width: number,
	height: number,
	block: number,
): Uint8ClampedArray {
	const output = new Uint8ClampedArray(source.length);
	if (width <= 0 || height <= 0 || block <= 1) {
		output.set(source);
		return output;
	}
	for (let blockY = 0; blockY < height; blockY += block) {
		for (let blockX = 0; blockX < width; blockX += block) {
			const maxX = Math.min(blockX + block, width);
			const maxY = Math.min(blockY + block, height);
			let red = 0;
			let green = 0;
			let blue = 0;
			let alpha = 0;
			let count = 0;
			for (let y = blockY; y < maxY; y += 1) {
				for (let x = blockX; x < maxX; x += 1) {
					const index = (y * width + x) * 4;
					red += source[index];
					green += source[index + 1];
					blue += source[index + 2];
					alpha += source[index + 3];
					count += 1;
				}
			}
			if (count === 0) continue;
			const average = [
				Math.round(red / count),
				Math.round(green / count),
				Math.round(blue / count),
				Math.round(alpha / count),
			];
			for (let y = blockY; y < maxY; y += 1) {
				for (let x = blockX; x < maxX; x += 1) {
					const index = (y * width + x) * 4;
					output[index] = average[0];
					output[index + 1] = average[1];
					output[index + 2] = average[2];
					output[index + 3] = average[3];
				}
			}
		}
	}
	return output;
}

/* ------------------------------------------------------------------ *
 * Bounded snapshot history
 * ------------------------------------------------------------------ */

export type SnapshotStack<T> = {
	/** Index 0 is always the pristine image; the last entry is the current state. */
	past: T[];
	future: T[];
	/** Index of the snapshot currently displayed. */
	index: number;
};

export function createSnapshotStack<T>(initial: T): SnapshotStack<T> {
	return { past: [initial], future: [], index: 0 };
}

/**
 * Record a new state produced by an edit. Branches created after an undo drop
 * the abandoned redo snapshots, and the oldest snapshot (the original) is kept
 * so `resetToOriginal` always has something to fall back on.
 */
export function pushSnapshot<T>(
	stack: SnapshotStack<T>,
	snapshot: T,
	maxHistory = MAX_HISTORY,
): SnapshotStack<T> {
	const keptPast = stack.past.slice(0, stack.index + 1);
	const past = [...keptPast, snapshot];
	if (past.length > maxHistory + 1) {
		const trimmed = past.slice(past.length - (maxHistory + 1));
		return { past: trimmed, future: [], index: trimmed.length - 1 };
	}
	return { past, future: [], index: past.length - 1 };
}

export function canUndo<T>(stack: SnapshotStack<T>): boolean {
	return stack.index > 0;
}

export function canRedo<T>(stack: SnapshotStack<T>): boolean {
	return stack.index < stack.past.length - 1;
}

/** Step one snapshot back. Returns the same object when there is nothing to undo. */
export function undoSnapshot<T>(stack: SnapshotStack<T>): SnapshotStack<T> {
	if (!canUndo(stack)) return stack;
	return { past: stack.past, future: stack.future, index: stack.index - 1 };
}

export function redoSnapshot<T>(stack: SnapshotStack<T>): SnapshotStack<T> {
	if (!canRedo(stack)) return stack;
	return { past: stack.past, future: stack.future, index: stack.index + 1 };
}

/** Collapse the stack back to a single pristine snapshot. */
export function resetSnapshotStack<T>(original: T): SnapshotStack<T> {
	return createSnapshotStack(original);
}

/** True when the displayed snapshot differs from the last saved one. */
export function isStackDirty<T>(stack: SnapshotStack<T>, savedIndex: number): boolean {
	return stack.index !== savedIndex;
}

/* ------------------------------------------------------------------ *
 * Misc
 * ------------------------------------------------------------------ */

/** File name from an absolute path, tolerating both separators. */
export function baseName(filePath: string): string {
	const parts = filePath.split(/[\\/]/);
	return parts[parts.length - 1] || filePath;
}
