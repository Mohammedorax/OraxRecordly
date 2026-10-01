import { describe, expect, it } from "vitest";
import {
	appendPoint,
	arrowAngle,
	arrowHeadPoints,
	baseName,
	canRedo,
	canUndo,
	canvasBackingSize,
	canvasToImage,
	canvasTransform,
	centeredPan,
	clampRegionToImage,
	clampZoom,
	computeViewport,
	CROP_HANDLE_SIZE,
	CROP_HANDLES,
	cropHandleSpots,
	type CropHandle,
	cropRectFromDrag,
	ellipseFromDrag,
	fitView,
	fitZoom,
	hitCropHandle,
	imageToCanvas,
	imageToScreen,
	isStackDirty,
	isUsableCrop,
	MAX_HISTORY,
	panKeepingViewCenter,
	pixelateRegion,
	pixelBlockSize,
	type Point,
	pushSnapshot,
	type Rect,
	redoSnapshot,
	resetSnapshotStack,
	resizeCropRect,
	screenToImage,
	type Size,
	textInset,
	undoSnapshot,
	type Viewport,
	zoomAroundPoint,
} from "./imageEditorGeometry";

/* ------------------------------------------------------------------ *
 * Viewport fixtures
 * ------------------------------------------------------------------ */

const FRAME: Size = { width: 400, height: 300 };
const IMAGE: Size = { width: 800, height: 600 };

/**
 * Build a viewport through `computeViewport` (the pump every caller uses). When
 * explicit offsets are requested they replace the clamped pan, so the matrix can
 * cover positive, negative and zero offsets that `clampOffset` would not emit.
 */
function viewportFor(options: {
	dpr?: number;
	zoom?: number;
	frame?: Size;
	image?: Size;
	offsetX?: number;
	offsetY?: number;
}): Viewport {
	const base = computeViewport(
		options.image ?? IMAGE,
		options.frame ?? FRAME,
		options.zoom ?? 1,
		{ x: 0, y: 0 },
		options.dpr ?? 1,
	);
	if (options.offsetX === undefined && options.offsetY === undefined) return base;
	return {
		...base,
		offsetX: options.offsetX ?? base.offsetX,
		offsetY: options.offsetY ?? base.offsetY,
	};
}

/** Zoom levels including the "fit to window" value and where the cap used to engage. */
const FIT = fitZoom(IMAGE, FRAME);
const ZOOM_LEVELS = [FIT, 0.5, 1, 2, 8];
const DP_RATIOS = [1, 1.25, 1.5, 2];
const OFFSETS = [0, 120, -60];
const SAMPLE_POINTS: Point[] = [
	{ x: 0, y: 0 },
	{ x: 137.5, y: 88.25 },
	{ x: IMAGE.width, y: IMAGE.height },
];

describe("crop geometry", () => {
	const bounds = { width: 1000, height: 800 };

	it("normalizes a drag regardless of direction", () => {
		expect(cropRectFromDrag({ x: 300, y: 200 }, { x: 100, y: 50 }, bounds)).toEqual({
			x: 100,
			y: 50,
			width: 200,
			height: 150,
		});
	});

	it("clamps a drag that runs past the image edges", () => {
		expect(cropRectFromDrag({ x: -50, y: -20 }, { x: 5000, y: 900 }, bounds)).toEqual({
			x: 0,
			y: 0,
			width: 1000,
			height: 800,
		});
	});

	it("resizes from a corner while pinning the opposite edge", () => {
		const rect = { x: 100, y: 100, width: 200, height: 200 };
		expect(resizeCropRect(rect, "nw", { x: 150, y: 120 }, bounds)).toEqual({
			x: 150,
			y: 120,
			width: 150,
			height: 180,
		});
		expect(resizeCropRect(rect, "se", { x: 500, y: 400 }, bounds)).toEqual({
			x: 100,
			y: 100,
			width: 400,
			height: 300,
		});
	});

	it("moves the rectangle without changing its size", () => {
		const rect = { x: 100, y: 100, width: 200, height: 150 };
		expect(resizeCropRect(rect, "move", { x: 60, y: 25 }, bounds)).toEqual({
			x: 160,
			y: 125,
			width: 200,
			height: 150,
		});
	});

	it("keeps a dragged edge from crossing the opposite one", () => {
		const rect = { x: 100, y: 100, width: 200, height: 200 };
		const flipped = resizeCropRect(rect, "w", { x: 900, y: 0 }, bounds);
		expect(flipped.x).toBe(rect.x + rect.width - 8);
		expect(flipped.width).toBe(8);
	});

	it("rejects rectangles smaller than the minimum", () => {
		expect(isUsableCrop({ x: 0, y: 0, width: 3, height: 40 })).toBe(false);
		expect(isUsableCrop({ x: 0, y: 0, width: 40, height: 40 })).toBe(true);
	});
});

describe("crop handles", () => {
	const rect: Rect = { x: 100, y: 80, width: 200, height: 160 };
	const spotOf = (handle: CropHandle): Point => {
		const found = cropHandleSpots(rect).find((entry) => entry.handle === handle);
		if (!found) throw new Error(`handle ${handle} is missing`);
		return found.point;
	};

	it("exposes all eight handles in hit-test order", () => {
		expect(cropHandleSpots(rect).map((entry) => entry.handle)).toEqual([...CROP_HANDLES]);
		expect(CROP_HANDLES).toHaveLength(8);
	});

	it("anchors each handle on its physical edge", () => {
		expect(spotOf("nw")).toEqual({ x: 100, y: 80 });
		expect(spotOf("n")).toEqual({ x: 200, y: 80 });
		expect(spotOf("ne")).toEqual({ x: 300, y: 80 });
		expect(spotOf("e")).toEqual({ x: 300, y: 160 });
		expect(spotOf("se")).toEqual({ x: 300, y: 240 });
		expect(spotOf("s")).toEqual({ x: 200, y: 240 });
		expect(spotOf("sw")).toEqual({ x: 100, y: 240 });
		expect(spotOf("w")).toEqual({ x: 100, y: 160 });
	});

	it("grabs the handle that is drawn under the pointer at any zoom", () => {
		for (const scale of [0.25, 0.5, 1, 2, 8]) {
			for (const { handle, point } of cropHandleSpots(rect)) {
				expect(hitCropHandle(point, rect, scale)).toBe(handle);
			}
		}
	});

	it("derives the grab reach from the size the handle is drawn with", () => {
		const scale = 2.5;
		// The reach is CROP_HANDLE_SIZE CSS pixels on screen, in image pixels.
		const reach = CROP_HANDLE_SIZE / scale;
		expect(reach).toBeCloseTo(3.6);
		// Just inside the grab area, above the top edge: the nw handle.
		expect(hitCropHandle({ x: rect.x, y: rect.y - reach + 0.001 }, rect, scale)).toBe("nw");
		// Half an image pixel past the grab area: nothing.
		expect(hitCropHandle({ x: rect.x, y: rect.y - reach - 0.5 }, rect, scale)).toBeNull();
	});

	it("reports the body as move and the outside as nothing", () => {
		expect(hitCropHandle({ x: 200, y: 160 }, rect, 1)).toBe("move");
		expect(hitCropHandle({ x: 20, y: 20 }, rect, 1)).toBeNull();
		expect(hitCropHandle({ x: 500, y: 400 }, rect, 8)).toBeNull();
	});

	it("maps every handle onto the same physical side it is drawn on", () => {
		// Whatever the document direction, image x maps straight onto physical
		// screen x, so "w" can only ever be the left edge.
		const v = computeViewport(IMAGE, FRAME, 1, { x: 0, y: 0 }, 2);
		const screen = (handle: CropHandle) => imageToScreen(spotOf(handle), v);
		expect(screen("nw").x).toBeLessThan(screen("ne").x);
		expect(screen("w").x).toBeLessThan(screen("e").x);
		expect(screen("sw").x).toBeLessThan(screen("se").x);
		expect(screen("nw").y).toBeLessThan(screen("sw").y);
		expect(screen("n").y).toBeLessThan(screen("s").y);
		expect(screen("ne").y).toBeLessThan(screen("se").y);
	});
});

describe("crop resize direction", () => {
	const bounds: Size = { width: 1000, height: 800 };
	const rect: Rect = { x: 300, y: 200, width: 200, height: 160 };
	const left = rect.x;
	const top = rect.y;
	const right = rect.x + rect.width;
	const bottom = rect.y + rect.height;

	// Drag each handle 50 x 40 image pixels outwards, along the diagonal for the
	// corners and straight out for the edges.
	const outward: Array<[CropHandle, Point]> = [
		["nw", { x: left - 50, y: top - 40 }],
		["n", { x: left + 20, y: top - 40 }],
		["ne", { x: right + 50, y: top - 40 }],
		["e", { x: right + 50, y: top + 20 }],
		["se", { x: right + 50, y: bottom + 40 }],
		["s", { x: left + 20, y: bottom + 40 }],
		["sw", { x: left - 50, y: bottom + 40 }],
		["w", { x: left - 50, y: top + 20 }],
	];

	const grown: Record<CropHandle, Rect> = {
		nw: { x: left - 50, y: top - 40, width: 250, height: 200 },
		n: { x: left, y: top - 40, width: 200, height: 200 },
		ne: { x: left, y: top - 40, width: 250, height: 200 },
		e: { x: left, y: top, width: 250, height: 160 },
		se: { x: left, y: top, width: 250, height: 200 },
		s: { x: left, y: top, width: 200, height: 200 },
		sw: { x: left - 50, y: top, width: 250, height: 200 },
		w: { x: left - 50, y: top, width: 250, height: 160 },
	};

	it("grows towards the dragged edge and pins the opposite one for all 8 handles", () => {
		for (const [handle, point] of outward) {
			expect(resizeCropRect(rect, handle, point, bounds)).toEqual(grown[handle]);
		}
	});

	it("pins the edge opposite every dragged edge", () => {
		for (const [handle, point] of outward) {
			const next = resizeCropRect(rect, handle, point, bounds);
			if (handle.includes("w")) expect(next.x + next.width).toBe(right);
			else expect(next.x).toBe(left);
			if (handle.includes("e")) expect(next.x).toBe(left);
			else expect(next.x + next.width).toBe(right);
			if (handle.includes("n")) expect(next.y + next.height).toBe(bottom);
			else expect(next.y).toBe(top);
			if (handle.includes("s")) expect(next.y).toBe(top);
			else expect(next.y + next.height).toBe(bottom);
		}
	});
});

describe("region clamping", () => {
	const bounds = { width: 1000, height: 800 };

	it("normalizes a rect that was given in any direction", () => {
		expect(clampRegionToImage({ x: 300, y: 200, width: -200, height: -150 }, bounds)).toEqual({
			x: 100,
			y: 50,
			width: 200,
			height: 150,
		});
	});

	it("clamps a rect to the image and snaps it to whole pixels", () => {
		expect(
			clampRegionToImage({ x: -50.4, y: -20.6, width: 1050.8, height: 900.2 }, bounds),
		).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
	});

	it("keeps a region that ends exactly on the far edge", () => {
		expect(clampRegionToImage({ x: 500, y: 400, width: 500, height: 400 }, bounds)).toEqual({
			x: 500,
			y: 400,
			width: 500,
			height: 400,
		});
	});

	it("collapses a region that lies outside the image, which is rejected", () => {
		const outside = clampRegionToImage({ x: -300, y: -200, width: 100, height: 50 }, bounds);
		expect(outside).toEqual({ x: 0, y: 0, width: 0, height: 0 });
		expect(isUsableCrop(outside)).toBe(false);
	});

	it("gives a usable rect for a drag that runs past the bottom-right corner", () => {
		const rect = clampRegionToImage({ x: 900, y: 700, width: 400, height: 300 }, bounds);
		expect(rect).toEqual({ x: 900, y: 700, width: 100, height: 100 });
		expect(isUsableCrop(rect)).toBe(true);
	});
});

describe("text inset", () => {
	it("reserves a quarter of the font size, the same value both sides read", () => {
		expect(textInset(10)).toBe(3);
		expect(textInset(32)).toBe(8);
		expect(textInset(96)).toBe(24);
	});
});

describe("viewport math", () => {
	it("fits the whole image inside the viewport, leaving the padding free", () => {
		// 1048 - 2*24 padding = 1000 available for a 1000px-wide image.
		expect(fitZoom({ width: 1000, height: 500 }, { width: 1048, height: 548 })).toBeCloseTo(1);
		expect(fitZoom({ width: 1000, height: 500 }, { width: 524, height: 548 })).toBeCloseTo(
			0.476,
		);
	});

	it("survives a zero-sized viewport", () => {
		expect(fitZoom({ width: 800, height: 600 }, { width: 0, height: 0 })).toBe(1);
	});

	it("round-trips between image and screen space", () => {
		const viewport = computeViewport(
			{ width: 800, height: 600 },
			{ width: 400, height: 300 },
			2,
			{ x: -30, y: -40 },
			2,
		);
		const imagePoint = { x: 100, y: 120 };
		const back = screenToImage(imageToScreen(imagePoint, viewport), viewport);
		expect(back.x).toBeCloseTo(100);
		expect(back.y).toBeCloseTo(120);
	});

	it("scales the backing store by the device pixel ratio", () => {
		expect(canvasBackingSize({ width: 300, height: 150 }, 2)).toEqual({
			width: 600,
			height: 300,
		});
	});

	it("keeps the pixel under the cursor fixed while zooming", () => {
		const viewport = computeViewport(
			{ width: 800, height: 600 },
			{ width: 400, height: 300 },
			1,
			{ x: 0, y: 0 },
			1,
		);
		const anchor = { x: 200, y: 150 };
		const imageUnderAnchor = screenToImage(anchor, viewport);
		const nextPan = zoomAroundPoint(2, anchor, viewport);
		const nextViewport = computeViewport(
			{ width: 800, height: 600 },
			{ width: 400, height: 300 },
			2,
			nextPan,
			1,
		);
		const moved = imageToScreen(imageUnderAnchor, nextViewport);
		expect(moved.x).toBeCloseTo(anchor.x);
		expect(moved.y).toBeCloseTo(anchor.y);
	});

	it("bounds the zoom range", () => {
		expect(clampZoom(0)).toBeGreaterThan(0);
		expect(clampZoom(1000)).toBeLessThanOrEqual(8);
	});

	it("never clamps the drawing scale away from the zoom", () => {
		const huge = computeViewport(
			{ width: 3840, height: 2160 },
			{ width: 1200, height: 800 },
			8,
			{ x: 0, y: 0 },
			2,
		);
		expect(huge.zoom).toBe(8);
		// The old `min(dpr * zoom, 4)` cap made the render transform disagree with
		// the pointer mapping above 4x; both sides now read dpr * zoom.
		expect(huge.detailScale).toBe(16);
		expect(huge.detailScale).toBe(huge.dpr * huge.zoom);

		const normal = computeViewport(
			{ width: 3840, height: 2160 },
			{ width: 1200, height: 800 },
			1,
			{ x: 0, y: 0 },
			2,
		);
		expect(normal.detailScale).toBe(2);
	});

	it("bounds the backing store by the surface instead of by the zoom", () => {
		const v = computeViewport(
			{ width: 3840, height: 2160 },
			{ width: 1200, height: 800 },
			8,
			{ x: 0, y: 0 },
			2,
		);
		expect(canvasBackingSize({ width: v.frameWidth, height: v.frameHeight }, v.dpr)).toEqual({
			width: 2400,
			height: 1600,
		});
	});
});

describe("fit and centre", () => {
	it("splits the leftover space evenly on both axes", () => {
		const image = { width: 1000, height: 500 };
		const viewport = { width: 1048, height: 548 };
		const { zoom, pan } = fitView(image, viewport);
		expect(zoom).toBeCloseTo(1);
		expect(pan).toEqual({ x: 24, y: 24 });
		// The centred pan is exactly what `computeViewport` keeps, so the drawn
		// picture and the pointer mapping agree on the same origin.
		const v = computeViewport(image, viewport, zoom, pan, 1);
		expect(v.offsetX).toBe(pan.x);
		expect(v.offsetY).toBe(pan.y);
	});

	it("centres a tall image in a wide viewport and vice versa", () => {
		const cases: Array<[Size, Size]> = [
			[
				{ width: 400, height: 1600 },
				{ width: 1200, height: 800 },
			],
			[
				{ width: 1600, height: 400 },
				{ width: 800, height: 1200 },
			],
			[
				{ width: 333, height: 777 },
				{ width: 901, height: 902 },
			],
		];
		for (const [image, viewport] of cases) {
			const { zoom, pan } = fitView(image, viewport);
			const v = computeViewport(image, viewport, zoom, pan, 2);
			const slackX = viewport.width - image.width * zoom;
			const slackY = viewport.height - image.height * zoom;
			expect(v.offsetX).toBeCloseTo(slackX / 2);
			expect(v.offsetY).toBeCloseTo(slackY / 2);
			// Never clamped away from the centre.
			expect(v.offsetX).toBeCloseTo(pan.x);
			expect(v.offsetY).toBeCloseTo(pan.y);
		}
	});

	it("centres an image that overflows the viewport once zoomed in", () => {
		const image = { width: 800, height: 600 };
		const viewport = { width: 400, height: 300 };
		const pan = centeredPan(image, viewport, 4);
		expect(pan).toEqual({ x: -1400, y: -1050 });
		const v = computeViewport(image, viewport, 4, pan, 2);
		expect(v.offsetX).toBe(pan.x);
		expect(v.offsetY).toBe(pan.y);
	});

	it("returns a finite pan for a viewport that has not been measured yet", () => {
		const { zoom, pan } = fitView({ width: 800, height: 600 }, { width: 0, height: 0 });
		expect(zoom).toBe(1);
		expect(Number.isFinite(pan.x)).toBe(true);
		expect(Number.isFinite(pan.y)).toBe(true);
	});

	it("keeps a centred image centred when the viewport changes size", () => {
		const image = { width: 800, height: 600 };
		const before = { width: 400, height: 300 };
		const after = { width: 900, height: 500 };
		const zoom = 2;
		const pan = centeredPan(image, before, zoom);
		expect(panKeepingViewCenter({ viewport: before, zoom, pan }, after)).toEqual(
			centeredPan(image, after, zoom),
		);
	});

	it("pins the image point that sat under the old viewport centre", () => {
		const before = { width: 500, height: 400 };
		const after = { width: 800, height: 400 };
		const zoom = 3;
		const pan = { x: -120, y: 40 };
		const pinned = {
			x: (before.width / 2 - pan.x) / zoom,
			y: (before.height / 2 - pan.y) / zoom,
		};
		const next = panKeepingViewCenter({ viewport: before, zoom, pan }, after);
		expect((after.width / 2 - next.x) / zoom).toBeCloseTo(pinned.x);
		expect((after.height / 2 - next.y) / zoom).toBeCloseTo(pinned.y);
	});
});

describe("screen / image / canvas conversion", () => {
	it("round-trips screenToImage(imageToScreen(p)) across the whole matrix", () => {
		for (const dpr of DP_RATIOS) {
			for (const zoom of ZOOM_LEVELS) {
				for (const offsetX of OFFSETS) {
					for (const offsetY of OFFSETS) {
						const v = viewportFor({ dpr, zoom, offsetX, offsetY });
						for (const point of SAMPLE_POINTS) {
							const back = screenToImage(imageToScreen(point, v), v);
							expect(back.x).toBeCloseTo(point.x, 9);
							expect(back.y).toBeCloseTo(point.y, 9);
						}
					}
				}
			}
		}
	});

	it("draws a point and hit-tests it on the same canvas / image pixel", () => {
		for (const dpr of DP_RATIOS) {
			for (const zoom of ZOOM_LEVELS) {
				for (const offsetX of OFFSETS) {
					for (const offsetY of OFFSETS) {
						const v = viewportFor({ dpr, zoom, offsetX, offsetY });
						const point = { x: 137.5, y: 88.25 };
						const screen = imageToScreen(point, v);
						const device = imageToCanvas(point, v);
						// The render transform is the screen mapping in device pixels.
						expect(device.x).toBeCloseTo(screen.x * dpr, 9);
						expect(device.y).toBeCloseTo(screen.y * dpr, 9);
						// The canvas pixel the stroke lands on inverts to the exact
						// point the pointer path derives from the same screen spot.
						const viaCanvas = canvasToImage(device, v);
						const viaScreen = screenToImage(screen, v);
						expect(viaCanvas.x).toBeCloseTo(viaScreen.x, 9);
						expect(viaCanvas.y).toBeCloseTo(viaScreen.y, 9);
						expect(viaCanvas.x).toBeCloseTo(point.x, 9);
						expect(viaCanvas.y).toBeCloseTo(point.y, 9);
					}
				}
			}
		}
	});

	it("never lets the browser rescale the bitmap into the CSS box", () => {
		// The canvas' CSS box is the frame; the bitmap is `frame * dpr`. If the
		// backing store were derived from the displayed image (as the old
		// `2 * offset + display` formula did), the compositor would stretch the
		// bitmap and every drawn pixel would land away from the pointer.
		for (const zoom of ZOOM_LEVELS) {
			for (const dpr of DP_RATIOS) {
				for (const pan of [
					{ x: 0, y: 0 },
					{ x: 60, y: -40 },
				]) {
					const v = computeViewport(IMAGE, FRAME, zoom, pan, dpr);
					const backing = canvasBackingSize(
						{ width: v.frameWidth, height: v.frameHeight },
						v.dpr,
					);
					const bitmapToCss = {
						x: v.frameWidth / backing.width,
						y: v.frameHeight / backing.height,
					};
					expect(bitmapToCss.x).toBeCloseTo(1 / dpr, 12);
					expect(bitmapToCss.y).toBeCloseTo(1 / dpr, 12);

					// Where the stroke is actually seen, versus where the pointer
					// path says the image pixel is.
					const point = { x: 611, y: 233 };
					const device = imageToCanvas(point, v);
					const seen = { x: device.x * bitmapToCss.x, y: device.y * bitmapToCss.y };
					const expected = imageToScreen(point, v);
					expect(seen.x).toBeCloseTo(expected.x, 6);
					expect(seen.y).toBeCloseTo(expected.y, 6);
				}
			}
		}
	});

	it("exposes the render transform as a 2D matrix the canvas can apply", () => {
		const v = viewportFor({ dpr: 2, zoom: 2, offsetX: 30, offsetY: -20 });
		expect(canvasTransform(v)).toEqual([4, 0, 0, 4, 60, -40]);
		expect(canvasTransform(v)[0]).toBe(v.detailScale);
	});

	it("keeps the canvas CSS box equal to the frame the conversion assumes", () => {
		const v = computeViewport(IMAGE, FRAME, 1, { x: 0, y: 0 }, 2);
		expect(v.frameWidth).toBe(FRAME.width);
		expect(v.frameHeight).toBe(FRAME.height);
		// A quarter-pixel device ratio still rounds to a whole backing pixel.
		expect(canvasBackingSize({ width: 333, height: 100 }, 1.25)).toEqual({
			width: 416,
			height: 125,
		});
	});
});

describe("shapes", () => {
	it("points the arrow head along the drag direction", () => {
		expect(arrowAngle({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(0);
		expect(arrowAngle({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(Math.PI / 2);
	});

	it("builds a triangle whose tip is the end point", () => {
		const tip = { x: 100, y: 100 };
		const head = arrowHeadPoints(tip, 0, 4);
		expect(head).toHaveLength(3);
		expect(head[0]).toEqual(tip);
		// With a zero angle the base sits to the left of the tip.
		expect(head[1].x).toBeLessThan(tip.x);
		expect(head[2].x).toBeLessThan(tip.x);
		expect(Math.abs(head[1].y - head[2].y)).toBeGreaterThan(0);
	});

	it("derives ellipse radii from the drag bounding box", () => {
		expect(ellipseFromDrag({ x: 10, y: 20 }, { x: 110, y: 70 })).toEqual({
			centerX: 60,
			centerY: 45,
			radiusX: 50,
			radiusY: 25,
		});
	});

	it("thins out pen samples that land on the same spot", () => {
		const first = appendPoint([], { x: 5, y: 5 });
		expect(appendPoint(first, { x: 5.4, y: 5.4 })).toHaveLength(1);
		expect(appendPoint(first, { x: 9, y: 9 })).toHaveLength(2);
	});
});

describe("pixelate region", () => {
	it("picks a larger block for a larger region", () => {
		expect(pixelBlockSize(28, 14)).toBeLessThan(pixelBlockSize(280, 140));
		expect(pixelBlockSize(4, 4)).toBeGreaterThanOrEqual(2);
	});

	it("averages each block into a flat colour", () => {
		// 2x2 image, one block of 2x2 -> a single averaged colour everywhere.
		const source = new Uint8ClampedArray([
			0, 0, 0, 255, 100, 100, 100, 255, 200, 200, 200, 255, 40, 40, 40, 255,
		]);
		const result = pixelateRegion(source, 2, 2, 2);
		const first = [result[0], result[1], result[2], result[3]];
		for (let index = 0; index < result.length; index += 4) {
			expect([
				result[index],
				result[index + 1],
				result[index + 2],
				result[index + 3],
			]).toEqual(first);
		}
		expect(first[0]).toBe(85);
	});

	it("returns the input unchanged when there is nothing to block", () => {
		const source = new Uint8ClampedArray([1, 2, 3, 4]);
		expect(Array.from(pixelateRegion(source, 1, 1, 1))).toEqual([1, 2, 3, 4]);
	});
});

describe("bounded snapshot history", () => {
	it("starts on the original snapshot with nothing to undo", () => {
		const stack = resetSnapshotStack("original");
		expect(stack.past).toEqual(["original"]);
		expect(stack.index).toBe(0);
		expect(canUndo(stack)).toBe(false);
		expect(canRedo(stack)).toBe(false);
	});

	it("walks back and forward through committed snapshots", () => {
		let stack = resetSnapshotStack("a");
		stack = pushSnapshot(stack, "b");
		stack = pushSnapshot(stack, "c");
		expect(canUndo(stack)).toBe(true);
		expect(canRedo(stack)).toBe(false);

		stack = undoSnapshot(stack);
		expect(stack.past[stack.index]).toBe("b");
		expect(canRedo(stack)).toBe(true);

		stack = redoSnapshot(stack);
		expect(stack.past[stack.index]).toBe("c");
	});

	it("drops redo snapshots once a new edit branches off", () => {
		let stack = resetSnapshotStack("a");
		stack = pushSnapshot(stack, "b");
		stack = pushSnapshot(stack, "c");
		stack = undoSnapshot(stack);
		stack = pushSnapshot(stack, "d");
		expect(stack.past).toEqual(["a", "b", "d"]);
		expect(stack.index).toBe(2);
		expect(canRedo(stack)).toBe(false);
	});

	it("bounds memory by keeping only the newest snapshots", () => {
		let stack = resetSnapshotStack(0);
		for (let value = 1; value <= MAX_HISTORY + 10; value += 1) {
			stack = pushSnapshot(stack, value, MAX_HISTORY);
		}
		expect(stack.past).toHaveLength(MAX_HISTORY + 1);
		expect(stack.past[stack.index]).toBe(MAX_HISTORY + 10);
		expect(stack.past).not.toContain(0);
	});

	it("tracks the saved snapshot for the dirty flag", () => {
		let stack = resetSnapshotStack("a");
		stack = pushSnapshot(stack, "b");
		expect(isStackDirty(stack, 0)).toBe(true);
		stack = undoSnapshot(stack);
		expect(isStackDirty(stack, 0)).toBe(false);
	});
});

describe("baseName", () => {
	it("handles both path separators and bare file names", () => {
		expect(baseName("C:\\Users\\me\\Pictures\\shot.png")).toBe("shot.png");
		expect(baseName("/home/me/shot.png")).toBe("shot.png");
		expect(baseName("shot.png")).toBe("shot.png");
	});
});
