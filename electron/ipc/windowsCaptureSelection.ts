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
	/** Electron's DIP-to-physical factor for this display; 1 when unknown. */
	scaleFactor?: number;
};

export type ResolvedWindowsCaptureDisplay = {
	displayId: number;
	bounds: WindowsCaptureDisplayBounds;
	/** False when the requested display id could not be resolved and the primary was used. */
	matchedRequestedDisplay?: boolean;
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
	const hasRequestedDisplayId = Number.isFinite(requestedDisplayId) && requestedDisplayId > 0;
	const requestedOrPrimaryDisplayId = hasRequestedDisplayId
		? requestedDisplayId
		: primaryDisplayId;

	const matchedDisplay =
		allDisplays.find((display) => String(display.id) === String(requestedOrPrimaryDisplayId)) ??
		primaryDisplay;

	return {
		displayId: requestedOrPrimaryDisplayId,
		bounds: matchedDisplay.bounds,
		// False when the id the renderer sent could not be found again: the bounds
		// then belong to the primary display and must not be treated as the user's
		// choice.
		matchedRequestedDisplay:
			hasRequestedDisplayId &&
			String(matchedDisplay.id) === String(requestedOrPrimaryDisplayId),
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

export type MonitorSelectionStrategy =
	| "exact-bounds"
	| "scale-match"
	| "ordered-display"
	| "sole-aspect-match";

export type ResolvedMonitorSelection = {
	/** HMONITOR handle the native helper can use directly. */
	handle: number;
	/** Physical rectangle of that monitor, the space the helper works in. */
	bounds: WindowsCaptureDisplayBounds;
	strategy: MonitorSelectionStrategy;
};

/** Aspect ratios may differ a little between the DIP rect and the panel. */
const MONITOR_ASPECT_TOLERANCE = 0.02;
/** Windows scaling stays well inside this range; anything else is not a match. */
const MIN_DISPLAY_SCALE = 0.5;
const MAX_DISPLAY_SCALE = 4;
/** The two axes must imply the same scale factor for the same panel. */
const SCALE_TOLERANCE = 0.02;

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

/**
 * The scale factor a monitor implies for a display, or `null` when the two
 * cannot be the same panel.
 *
 * This is what makes the pairing checkable: the same physical panel at 150%
 * reports a DIP rect 1.5x smaller in *both* axes, so the two implied scales must
 * agree. Comparing only aspect ratios cannot tell two identical 16:9 panels
 * apart, and comparing only the top-left corner reports the wrong monitor as soon
 * as one scaled display starts where another one physically runs.
 */
function impliedScale(
	display: WindowsCaptureDisplayBounds,
	monitor: WinMonitorLike,
): number | null {
	if (
		display.width <= 0 ||
		display.height <= 0 ||
		monitor.width <= 0 ||
		monitor.height <= 0 ||
		!hasMatchingAspect(display, monitor)
	) {
		return null;
	}

	const scaleX = monitor.width / display.width;
	const scaleY = monitor.height / display.height;
	if (
		scaleX < MIN_DISPLAY_SCALE ||
		scaleX > MAX_DISPLAY_SCALE ||
		Math.abs(scaleX - scaleY) > SCALE_TOLERANCE * Math.max(scaleX, scaleY)
	) {
		return null;
	}

	return scaleX;
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
 * Every strategy is validated before it is trusted, so returning `null` (and
 * leaving the old behaviour to the helper) is always safe:
 * 1. the same top-left corner *and* a scale the monitor can plausibly belong to -
 *    the 100%-scaling case, and any case where the corner is unambiguous;
 * 2. the monitor whose implied scale is consistent, when exactly one qualifies;
 * 3. pairing by relative order, validated by aspect *and* scale, for the layouts
 *    where several identical panels are in play;
 * 4. a single monitor whose aspect matches - unambiguous by construction.
 */
export function selectWindowsMonitorHandle(
	display: WindowsCaptureDisplayLike,
	allDisplays: WindowsCaptureDisplayLike[],
	monitors: WinMonitorLike[],
): ResolvedMonitorSelection | null {
	if (monitors.length === 0) {
		return null;
	}

	// The strongest evidence available: pair every display with a monitor by
	// relative order and then check the whole pairing against the scale factor
	// Electron reports. Order alone cannot be trusted (an enumeration order can
	// swap two panels), but order plus a scale-corrected size check can: a 4K panel
	// at 200% and a 1080p panel at 100% are both 1920 DIP wide, so only the
	// physical size distinguishes them.
	const orderedPairing = pairDisplaysWithMonitors(allDisplays, monitors);
	const pairedByOrder = orderedPairing?.get(display.id);
	if (pairedByOrder) {
		return {
			handle: pairedByOrder.handle,
			bounds: toBounds(pairedByOrder),
			strategy: "scale-match",
		};
	}

	const targetX = Math.round(display.bounds.x);
	const targetY = Math.round(display.bounds.y);

	const sameCorner = monitors.filter(
		(monitor) =>
			monitor.x === targetX &&
			monitor.y === targetY &&
			impliedScale(display.bounds, monitor) !== null,
	);
	if (sameCorner.length === 1) {
		return {
			handle: sameCorner[0].handle,
			bounds: toBounds(sameCorner[0]),
			strategy: "exact-bounds",
		};
	}

	// A single monitor whose size implies a plausible, self-consistent scale is a
	// stronger signal than enumeration order.
	const scaleMatches = monitors.filter(
		(monitor) => impliedScale(display.bounds, monitor) !== null,
	);
	if (scaleMatches.length === 1) {
		return {
			handle: scaleMatches[0].handle,
			bounds: toBounds(scaleMatches[0]),
			strategy: "scale-match",
		};
	}

	if (allDisplays.length === monitors.length) {
		// Scaling changes sizes but not the order of monitor origins, so the two
		// sorted lists line up. Aspect and scale both have to agree.
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
		if (paired && impliedScale(display.bounds, paired) !== null) {
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

/**
 * Pairs every display with a monitor, but only when the whole pairing survives a
 * physical check.
 *
 * Sorted by origin, displays and monitors line up: scaling changes sizes, not the
 * order of monitor origins. The pairing is then verified against the scale
 * factor - the size has to match what that scaling implies, and for a single row
 * the running physical origin has to follow from the displays before it. One
 * mismatch rejects the whole pairing, which is what stops a silent swap between
 * two identical panels.
 */
function pairDisplaysWithMonitors(
	allDisplays: WindowsCaptureDisplayLike[],
	monitors: WinMonitorLike[],
): Map<number, WinMonitorLike> | null {
	if (allDisplays.length !== monitors.length || allDisplays.length === 0) {
		return null;
	}

	const displays = [...allDisplays].sort(
		(left, right) =>
			left.bounds.x - right.bounds.x || left.bounds.y - right.bounds.y || left.id - right.id,
	);
	const physical = [...monitors].sort(
		(left, right) => left.x - right.x || left.y - right.y || left.width - right.width,
	);

	// Only a single row has a cumulative origin we can predict; a stacked layout
	// is still validated on size and aspect alone.
	const singleRow = physical.every((monitor) => monitor.y === physical[0].y);
	let expectedOriginX = physical[0].x;

	const paired = new Map<number, WinMonitorLike>();
	for (let index = 0; index < displays.length; index += 1) {
		const display = displays[index];
		const monitor = physical[index];
		const scale = display.scaleFactor ?? 1;

		if (
			!hasMatchingAspect(display.bounds, monitor) ||
			Math.abs(monitor.width - display.bounds.width * scale) >
				MONITOR_ASPECT_TOLERANCE * monitor.width ||
			Math.abs(monitor.height - display.bounds.height * scale) >
				MONITOR_ASPECT_TOLERANCE * monitor.height
		) {
			return null;
		}

		if (singleRow) {
			if (Math.abs(monitor.x - expectedOriginX) > 1) {
				return null;
			}
			expectedOriginX += monitor.width;
		}

		paired.set(display.id, monitor);
	}

	return paired;
}
