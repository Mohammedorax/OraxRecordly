export type WindowsCaptureSourceLike = {
	id?: string;
	display_id?: string;
	sourceType?: string;
};

export type WindowsCaptureDisplayBounds = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type WindowsCaptureDisplayLike = {
	id: number;
	bounds: WindowsCaptureDisplayBounds;
};

export type ResolvedWindowsCaptureDisplay = {
	displayId: number;
	bounds: WindowsCaptureDisplayBounds;
};

export function convertPhysicalBoundsToDip(
	bounds: WindowsCaptureDisplayBounds,
	convertPoint: (point: { x: number; y: number }) => { x: number; y: number },
): WindowsCaptureDisplayBounds {
	const topLeft = convertPoint({ x: bounds.x, y: bounds.y });
	const bottomRight = convertPoint({
		x: bounds.x + bounds.width,
		y: bounds.y + bounds.height,
	});

	return {
		x: topLeft.x,
		y: topLeft.y,
		width: Math.max(1, bottomRight.x - topLeft.x),
		height: Math.max(1, bottomRight.y - topLeft.y),
	};
}

export type ResolvedWindowsCaptureTarget =
	| {
			kind: "window";
			windowHandle: number;
	  }
	| {
			kind: "display";
			displayId: number;
			bounds: WindowsCaptureDisplayBounds;
	  }
	| {
			kind: "invalid-window";
	  };

function parseDesktopCapturerWindowHandle(sourceId?: string) {
	if (!sourceId) {
		return null;
	}

	const match = sourceId.match(/^window:(\d+)/);
	if (!match) {
		return null;
	}

	const handle = Number.parseInt(match[1], 10);
	return Number.isFinite(handle) && handle > 0 ? handle : null;
}

function isWindowCaptureSource(source: WindowsCaptureSourceLike | null | undefined) {
	return source?.sourceType === "window" || source?.id?.startsWith("window:") === true;
}

export function resolveWindowsCaptureDisplay(
	source: WindowsCaptureSourceLike | null | undefined,
	allDisplays: WindowsCaptureDisplayLike[],
	primaryDisplay: WindowsCaptureDisplayLike,
): ResolvedWindowsCaptureDisplay {
	const requestedDisplayId = Number(source?.display_id);
	const primaryDisplayId = Number(primaryDisplay.id);
	const requestedOrPrimaryDisplayId =
		Number.isFinite(requestedDisplayId) && requestedDisplayId > 0
			? requestedDisplayId
			: primaryDisplayId;

	const matchedDisplay =
		allDisplays.find((display) => String(display.id) === String(requestedOrPrimaryDisplayId)) ??
		primaryDisplay;

	return {
		displayId: requestedOrPrimaryDisplayId,
		bounds: matchedDisplay.bounds,
	};
}

export function resolveWindowsCaptureTarget(
	source: WindowsCaptureSourceLike | null | undefined,
	allDisplays: WindowsCaptureDisplayLike[],
	primaryDisplay: WindowsCaptureDisplayLike,
): ResolvedWindowsCaptureTarget {
	if (isWindowCaptureSource(source)) {
		const windowHandle = parseDesktopCapturerWindowHandle(source?.id);
		if (windowHandle !== null) {
			return {
				kind: "window",
				windowHandle,
			};
		}

		return {
			kind: "invalid-window",
		};
	}

	const resolvedDisplay = resolveWindowsCaptureDisplay(source, allDisplays, primaryDisplay);
	return {
		kind: "display",
		...resolvedDisplay,
	};
}

/** A monitor rectangle as the OS reports it: physical pixels, HMONITOR handle. */
export type WinMonitorLike = {
	handle: number;
	x: number;
	y: number;
	width: number;
	height: number;
};

export type MonitorSelectionStrategy = "exact-bounds" | "ordered-display" | "sole-aspect-match";

export type ResolvedMonitorSelection = {
	/** HMONITOR handle the native helper can use directly. */
	handle: number;
	/** Physical rectangle of that monitor, the space the helper works in. */
	bounds: WindowsCaptureDisplayBounds;
	strategy: MonitorSelectionStrategy;
};

/** Aspect ratios may differ a little between the DIP rect and the panel. */
const MONITOR_ASPECT_TOLERANCE = 0.02;

function hasMatchingAspect(display: WindowsCaptureDisplayBounds, monitor: WinMonitorLike): boolean {
	if (display.height <= 0 || monitor.height <= 0 || monitor.width <= 0) {
		return false;
	}

	const displayAspect = display.width / display.height;
	const monitorAspect = monitor.width / monitor.height;
	return (
		Math.abs(displayAspect - monitorAspect) <=
		MONITOR_ASPECT_TOLERANCE * Math.max(displayAspect, monitorAspect)
	);
}

function toBounds(monitor: WinMonitorLike): WindowsCaptureDisplayBounds {
	return { x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height };
}

/**
 * Resolves the HMONITOR handle for a screen the user picked.
 *
 * Electron reports display bounds in **DIP** while `EnumDisplayMonitors` reports
 * physical pixels, so matching on coordinates alone only works when every
 * display runs at 100% scaling. On a mixed-DPI desktop the coordinates never
 * matched, the Electron display id (which is not an HMONITOR) was forwarded
 * instead, and the native helper fell back to `MonitorFromRect` with DIP values -
 * which could land on a *different* monitor than the one the user selected.
 *
 * The strategies run from strongest to weakest and every one of them is
 * validated, so returning `null` (and leaving the old behaviour to the helper)
 * is always safe:
 * 1. exact physical top-left match - the 100%-scaling case;
 * 2. pairing by relative order, which scaling preserves - validated by aspect;
 * 3. a single monitor whose aspect matches - unambiguous by construction.
 */
export function selectWindowsMonitorHandle(
	display: WindowsCaptureDisplayLike,
	allDisplays: WindowsCaptureDisplayLike[],
	monitors: WinMonitorLike[],
): ResolvedMonitorSelection | null {
	if (monitors.length === 0) {
		return null;
	}

	const targetX = Math.round(display.bounds.x);
	const targetY = Math.round(display.bounds.y);

	const exact = monitors.find((monitor) => monitor.x === targetX && monitor.y === targetY);
	if (exact) {
		return { handle: exact.handle, bounds: toBounds(exact), strategy: "exact-bounds" };
	}

	if (allDisplays.length === monitors.length) {
		// Scaling changes sizes but not the order of monitor origins, so the two
		// sorted lists line up. The aspect check rejects a wrong pairing.
		const displays = [...allDisplays].sort(
			(left, right) =>
				left.bounds.x - right.bounds.x ||
				left.bounds.y - right.bounds.y ||
				left.id - right.id,
		);
		const physical = [...monitors].sort(
			(left, right) => left.x - right.x || left.y - right.y || left.width - right.width,
		);
		const index = displays.findIndex((candidate) => candidate.id === display.id);
		const paired = index >= 0 ? physical[index] : undefined;
		if (paired && hasMatchingAspect(display.bounds, paired)) {
			return { handle: paired.handle, bounds: toBounds(paired), strategy: "ordered-display" };
		}
	}

	const aspectMatches = monitors.filter((monitor) => hasMatchingAspect(display.bounds, monitor));
	if (aspectMatches.length === 1) {
		return {
			handle: aspectMatches[0].handle,
			bounds: toBounds(aspectMatches[0]),
			strategy: "sole-aspect-match",
		};
	}

	return null;
}
