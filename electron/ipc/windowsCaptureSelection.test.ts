import { describe, expect, it } from "vitest";

import {
	convertPhysicalBoundsToDip,
	resolveWindowsCaptureDisplay,
	resolveWindowsCaptureTarget,
	selectWindowsMonitorHandle,
} from "./windowsCaptureSelection";

describe("selectWindowsMonitorHandle", () => {
	const primaryDisplay = { id: 101, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
	const secondaryDisplay = {
		id: 202,
		bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
	};

	it("validates the whole pairing by scale when displays run at 100% scaling", () => {
		const selection = selectWindowsMonitorHandle(
			secondaryDisplay,
			[primaryDisplay, secondaryDisplay],
			[
				{ handle: 11, x: 0, y: 0, width: 1920, height: 1080 },
				{ handle: 22, x: 1920, y: 0, width: 2560, height: 1440 },
			],
		);

		expect(selection).toEqual({
			handle: 22,
			bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
			strategy: "scale-match",
		});
	});

	it("picks the right monitor when one scaled display starts where another physically runs", () => {
		// 4K at 200% on the left, then two 1080p panels at 100%. The third display's
		// DIP origin (3840) is the *physical* origin of the second monitor, which is
		// exactly the trap a top-left-only comparison falls into.
		const displays = [
			{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 2 },
			{ id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
			{ id: 3, bounds: { x: 3840, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
		];
		const monitors = [
			{ handle: 11, x: 0, y: 0, width: 3840, height: 2160 },
			{ handle: 22, x: 3840, y: 0, width: 1920, height: 1080 },
			{ handle: 33, x: 5760, y: 0, width: 1920, height: 1080 },
		];

		const third = selectWindowsMonitorHandle(displays[2], displays, monitors);
		expect(third).toEqual({
			handle: 33,
			bounds: { x: 5760, y: 0, width: 1920, height: 1080 },
			strategy: "scale-match",
		});

		// And the first display is not confused with the second monitor either.
		expect(selectWindowsMonitorHandle(displays[0], displays, monitors)?.handle).toBe(11);
	});

	it("pairs a scaled display with its physical monitor instead of the primary", () => {
		// 150% scaling on the primary: DIP 1280x720 maps to physical 1920x1080.
		const scaledPrimary = {
			id: 101,
			bounds: { x: 0, y: 0, width: 1280, height: 720 },
			scaleFactor: 1.5,
		};
		const externalDisplay = {
			id: 202,
			bounds: { x: 1280, y: 0, width: 1920, height: 1080 },
			scaleFactor: 1,
		};

		const selection = selectWindowsMonitorHandle(
			externalDisplay,
			[scaledPrimary, externalDisplay],
			[
				{ handle: 11, x: 0, y: 0, width: 1920, height: 1080 },
				{ handle: 22, x: 1920, y: 0, width: 1920, height: 1080 },
			],
		);

		expect(selection).toEqual({
			handle: 22,
			bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
			strategy: "scale-match",
		});
	});

	it("rejects a pairing whose aspect ratio cannot be the same panel", () => {
		const ultrawide = { id: 303, bounds: { x: 1920, y: 0, width: 3440, height: 1440 } };
		const selection = selectWindowsMonitorHandle(
			ultrawide,
			[ultrawide],
			[{ handle: 11, x: 0, y: 0, width: 1920, height: 1080 }],
		);

		expect(selection).toBeNull();
	});

	it("returns null when no monitor is enumerated, keeping the helper's fallback", () => {
		expect(selectWindowsMonitorHandle(primaryDisplay, [primaryDisplay], [])).toBeNull();
	});
});

describe("convertPhysicalBoundsToDip", () => {
	it("converts both physical edges so mixed-DPI window sizes stay aligned", () => {
		expect(
			convertPhysicalBoundsToDip({ x: 240, y: 60, width: 938, height: 1030 }, (point) => ({
				x: point.x / 1.5,
				y: point.y / 1.5,
			})),
		).toEqual({
			x: 160,
			y: 40,
			width: 625.3333333333334,
			height: 686.6666666666666,
		});
	});
});

describe("resolveWindowsCaptureDisplay", () => {
	const primaryDisplay = {
		id: 101,
		bounds: {
			x: 0,
			y: 0,
			width: 1920,
			height: 1080,
		},
	};

	const secondaryDisplay = {
		id: 202,
		bounds: {
			x: 1920,
			y: -40,
			width: 2560,
			height: 1440,
		},
	};

	it("uses the requested secondary display bounds for WGC fallback metadata", () => {
		const resolved = resolveWindowsCaptureDisplay(
			{ display_id: String(secondaryDisplay.id) },
			[primaryDisplay, secondaryDisplay],
			primaryDisplay,
		);

		expect(resolved).toEqual({
			displayId: secondaryDisplay.id,
			bounds: secondaryDisplay.bounds,
			matchedRequestedDisplay: true,
		});
	});

	it("falls back to the primary display when the source has no display id", () => {
		const resolved = resolveWindowsCaptureDisplay(
			undefined,
			[primaryDisplay, secondaryDisplay],
			primaryDisplay,
		);

		expect(resolved).toEqual({
			displayId: primaryDisplay.id,
			bounds: primaryDisplay.bounds,
			matchedRequestedDisplay: false,
		});
	});

	it("keeps the requested display id even if Electron cannot rematch it, while using primary bounds", () => {
		const resolved = resolveWindowsCaptureDisplay(
			{ display_id: "303" },
			[primaryDisplay, secondaryDisplay],
			primaryDisplay,
		);

		expect(resolved).toEqual({
			displayId: 303,
			bounds: primaryDisplay.bounds,
			matchedRequestedDisplay: false,
		});
	});
});

describe("resolveWindowsCaptureTarget", () => {
	const primaryDisplay = {
		id: 101,
		bounds: {
			x: 0,
			y: 0,
			width: 1920,
			height: 1080,
		},
	};

	const secondaryDisplay = {
		id: 202,
		bounds: {
			x: 1920,
			y: -40,
			width: 2560,
			height: 1440,
		},
	};

	it("uses a window handle when a Windows window source is selected", () => {
		const resolved = resolveWindowsCaptureTarget(
			{ id: "window:123456:0", sourceType: "window" },
			[primaryDisplay, secondaryDisplay],
			primaryDisplay,
		);

		expect(resolved).toEqual({
			kind: "window",
			windowHandle: 123456,
		});
	});

	it("does not silently turn an invalid window source into display capture", () => {
		const resolved = resolveWindowsCaptureTarget(
			{ id: "window:0:0", sourceType: "window", display_id: String(secondaryDisplay.id) },
			[primaryDisplay, secondaryDisplay],
			primaryDisplay,
		);

		expect(resolved).toEqual({
			kind: "invalid-window",
		});
	});

	it("keeps display capture behavior for selected screens", () => {
		const resolved = resolveWindowsCaptureTarget(
			{ id: "screen:202:0", sourceType: "screen", display_id: String(secondaryDisplay.id) },
			[primaryDisplay, secondaryDisplay],
			primaryDisplay,
		);

		expect(resolved).toEqual({
			kind: "display",
			displayId: secondaryDisplay.id,
			bounds: secondaryDisplay.bounds,
			matchedRequestedDisplay: true,
		});
	});
});
