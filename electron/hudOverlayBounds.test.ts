import { describe, expect, it } from "vitest";

import { getHudOverlayAnchor, getHudOverlayWindowBounds } from "./hudOverlayBounds";

describe("getHudOverlayWindowBounds", () => {
	const workArea = {
		x: 120,
		y: 40,
		width: 1920,
		height: 1040,
	};

	it("uses a bottom-centered box instead of the full work area", () => {
		expect(getHudOverlayWindowBounds(workArea)).toEqual({
			x: 650,
			y: 540,
			width: 860,
			height: 540,
		});
	});

	it("never changes size: the box is tall enough for the popovers at all times", () => {
		const idle = getHudOverlayWindowBounds(workArea);
		const dragged = getHudOverlayWindowBounds(workArea, {
			anchor: { x: 400, bottom: 900 },
		});
		const cornered = getHudOverlayWindowBounds(workArea, {
			anchor: { x: workArea.x, bottom: workArea.y + 540 },
		});

		expect([idle, dragged, cornered].map((bounds) => [bounds.width, bounds.height])).toEqual([
			[860, 540],
			[860, 540],
			[860, 540],
		]);
	});

	it("keeps the box inside small displays", () => {
		expect(
			getHudOverlayWindowBounds({
				x: -100,
				y: 20,
				width: 640,
				height: 420,
			}),
		).toEqual({
			x: -100,
			y: 20,
			width: 640,
			height: 420,
		});
	});

	it("keeps the dragged anchor on the bottom edge", () => {
		expect(
			getHudOverlayWindowBounds(workArea, {
				anchor: { x: 400, bottom: workArea.y + workArea.height },
			}),
		).toEqual({
			x: 400,
			y: 540,
			width: 860,
			height: 540,
		});
	});

	it("clamps an anchor that would push the box off the work area", () => {
		expect(
			getHudOverlayWindowBounds(workArea, {
				anchor: { x: 5000, bottom: 5000 },
			}),
		).toEqual({
			x: 1180,
			y: 540,
			width: 860,
			height: 540,
		});
	});
});

describe("getHudOverlayAnchor", () => {
	it("anchors the box on its bottom edge so a re-applied position keeps the bar still", () => {
		expect(
			getHudOverlayAnchor({
				x: 420,
				y: 700,
				width: 860,
				height: 540,
			}),
		).toEqual({
			x: 420,
			bottom: 1240,
		});
	});
});
