import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import styles from "./ScreenshotRegionOverlay.module.css";

/** Selection rectangle in CSS pixels relative to this window (one display). */
interface RegionRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * The region-selector slice of the preload bridge. Declared locally so the new
 * channel keeps type-checking while the shared bridge typings are updated in
 * parallel.
 */
interface ScreenshotRegionBridge {
	completeScreenshotRegion?: (rect: RegionRect | null) => Promise<void>;
	/** Keeps the main process's idle watchdog alive while the user is working. */
	notifyScreenshotRegionActivity?: () => void;
}

/** Below this size a pointer gesture is a click, not a selection. */
const MIN_SELECTION_SIZE = 2;
/** Arrow-key nudge distance, in CSS pixels (Shift = 10x). */
const NUDGE_STEP = 1;
/**
 * Minimum spacing between idle-watchdog keep-alives, in milliseconds.
 *
 * The main process cancels an overlay that has produced no input for a whole
 * minute (it guards a renderer that has hung). Pointer moves arrive far faster
 * than that, so the keep-alive is coalesced instead of being sent per event.
 */
const ACTIVITY_PING_INTERVAL_MS = 1_000;
/** Resize handles, in the order they are rendered. */
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
type HandleId = (typeof HANDLES)[number];

const HANDLE_CLASS_NAMES: Record<HandleId, string> = {
	nw: "handleNw",
	n: "handleN",
	ne: "handleNe",
	e: "handleE",
	se: "handleSe",
	s: "handleS",
	sw: "handleSw",
	w: "handleW",
};

type Gesture =
	| { type: "draw"; origin: { x: number; y: number } }
	| { type: "move"; startRect: RegionRect; origin: { x: number; y: number }; moved: boolean }
	| {
			type: "resize";
			handle: HandleId;
			startRect: RegionRect;
			origin: { x: number; y: number };
	  };

function clamp(value: number, min: number, max: number) {
	return Math.min(Math.max(value, min), max);
}

function rectFromPoints(startX: number, startY: number, endX: number, endY: number): RegionRect {
	return {
		x: Math.min(startX, endX),
		y: Math.min(startY, endY),
		width: Math.abs(endX - startX),
		height: Math.abs(endY - startY),
	};
}

/** Keep a nudged/moved selection inside the viewport without resizing it. */
function clampRectToViewport(rect: RegionRect): RegionRect {
	const maxX = Math.max(0, window.innerWidth - rect.width);
	const maxY = Math.max(0, window.innerHeight - rect.height);
	return { ...rect, x: clamp(rect.x, 0, maxX), y: clamp(rect.y, 0, maxY) };
}

/** Resize `start` by dragging `handle`, keeping the opposite edges anchored. */
function resizeRect(start: RegionRect, handle: HandleId, dx: number, dy: number): RegionRect {
	let left = start.x;
	let top = start.y;
	let right = start.x + start.width;
	let bottom = start.y + start.height;
	const min = MIN_SELECTION_SIZE;

	if (handle.includes("w")) {
		left = clamp(left + dx, 0, right - min);
	}
	if (handle.includes("e")) {
		right = clamp(right + dx, left + min, window.innerWidth);
	}
	if (handle.includes("n")) {
		top = clamp(top + dy, 0, bottom - min);
	}
	if (handle.includes("s")) {
		bottom = clamp(bottom + dy, top + min, window.innerHeight);
	}

	return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Fullscreen region selector that main loads as `?windowType=screenshot-region`.
 *
 * The window spans exactly one display, so pointer coordinates taken straight
 * from `clientX/clientY` are already the CSS pixels (DIP) the main process
 * expects.
 *
 * Selecting is two-step: dragging freezes the rectangle and switches to an
 * adjust phase with resize handles and a draggable body; Enter (or the Confirm
 * button) commits, Escape/right-click cancels. Power users keep a one-gesture
 * path: a double-click inside the selection, or a plain click without dragging
 * on an already frozen selection, confirms immediately. The result is reported
 * through `completeScreenshotRegion` exactly once.
 */
export default function ScreenshotRegionOverlay() {
	const t = useScopedT("launch");
	const displayId = useMemo(
		() => new URLSearchParams(window.location.search).get("displayId"),
		[],
	);
	const [rect, setRect] = useState<RegionRect | null>(null);
	const [phase, setPhase] = useState<"idle" | "drawing" | "adjusting">("idle");
	const gestureRef = useRef<Gesture | null>(null);
	const rectRef = useRef<RegionRect | null>(null);
	const sentRef = useRef(false);
	const lastActivityPingRef = useRef(0);

	/**
	 * Tell main the user is still working, so its idle watchdog does not destroy
	 * the overlay mid-selection. Throttled to one message per second; a missing
	 * bridge is not an error (the watchdog simply falls back to its own clock).
	 */
	const reportActivity = useCallback(() => {
		const bridge = window.electronAPI as unknown as ScreenshotRegionBridge | undefined;
		const notify = bridge?.notifyScreenshotRegionActivity;
		if (typeof notify !== "function") {
			return;
		}

		const now = Date.now();
		if (now - lastActivityPingRef.current < ACTIVITY_PING_INTERVAL_MS) {
			return;
		}

		lastActivityPingRef.current = now;
		notify();
	}, []);

	useEffect(() => {
		rectRef.current = rect;
	}, [rect]);

	// The main process normally makes the window transparent for this window
	// type; doing it here too keeps the overlay usable if that rule is missing.
	useEffect(() => {
		document.documentElement.style.background = "transparent";
		document.body.style.background = "transparent";
		document.body.style.overflow = "hidden";
		const root = document.getElementById("root");
		root?.style.setProperty("background", "transparent");
		root?.style.setProperty("overflow", "hidden");
	}, []);

	useEffect(() => {
		if (displayId) {
			console.debug(`Screenshot region overlay ready on display ${displayId}.`);
		}
	}, [displayId]);

	/**
	 * Report the selection to main. Guarded by `sentRef` so an Enter confirm
	 * followed by a stray click (or a right-click after Escape) cannot send twice.
	 */
	const submit = useCallback((selection: RegionRect | null) => {
		if (sentRef.current) {
			return;
		}

		const bridge = window.electronAPI as unknown as ScreenshotRegionBridge | undefined;
		const complete = bridge?.completeScreenshotRegion;
		if (typeof complete !== "function") {
			console.error("completeScreenshotRegion is not available on the preload bridge.");
			return;
		}

		sentRef.current = true;
		void (async () => {
			try {
				await complete(selection);
			} catch (error) {
				// Let the user try again instead of leaving the overlay mute.
				sentRef.current = false;
				console.error("Failed to complete the screenshot region selection:", error);
			}
		})();
	}, []);

	const cancel = useCallback(() => {
		submit(null);
	}, [submit]);

	const confirm = useCallback(() => {
		const current = rectRef.current;
		if (!current || current.width < MIN_SELECTION_SIZE || current.height < MIN_SELECTION_SIZE) {
			return;
		}
		submit(current);
	}, [submit]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			reportActivity();

			if (event.key === "Escape") {
				event.preventDefault();
				cancel();
				return;
			}

			if (event.key === "Enter") {
				event.preventDefault();
				confirm();
				return;
			}

			const deltas: Record<string, [number, number]> = {
				ArrowLeft: [-1, 0],
				ArrowRight: [1, 0],
				ArrowUp: [0, -1],
				ArrowDown: [0, 1],
			};
			const delta = deltas[event.key];
			if (!delta) {
				return;
			}

			// Nudge the frozen selection one pixel (ten with Shift); this stays
			// available during the adjust phase.
			event.preventDefault();
			const step = NUDGE_STEP * (event.shiftKey ? 10 : 1);
			setRect((current) =>
				current
					? clampRectToViewport({
							...current,
							x: current.x + delta[0] * step,
							y: current.y + delta[1] * step,
						})
					: current,
			);
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [cancel, confirm, reportActivity]);

	const pointFromEvent = (event: ReactPointerEvent<HTMLDivElement>) => ({
		x: clamp(event.clientX, 0, window.innerWidth),
		y: clamp(event.clientY, 0, window.innerHeight),
	});

	const capturePointer = (event: ReactPointerEvent<HTMLElement>) => {
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {
			// Pointer capture is an optimisation; dragging still works without it.
		}
	};

	/** Starts a brand-new selection; used from the dimmed backdrop. */
	const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		reportActivity();

		if (event.button === 2) {
			event.preventDefault();
			cancel();
			return;
		}

		if (event.button !== 0 || sentRef.current) {
			return;
		}

		// Starting a new drag always discards the previous rectangle, so the
		// overlay can be re-drawn as many times as needed.
		event.preventDefault();
		const point = pointFromEvent(event);
		gestureRef.current = { type: "draw", origin: point };
		capturePointer(event);
		setPhase("drawing");
		setRect({ x: point.x, y: point.y, width: 0, height: 0 });
	};

	/** Drag the frozen selection body; a click without movement confirms. */
	const handleMovePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.button !== 0 || sentRef.current) {
			return;
		}

		const current = rectRef.current;
		if (!current) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		gestureRef.current = {
			type: "move",
			startRect: current,
			origin: pointFromEvent(event),
			moved: false,
		};
		capturePointer(event);
	};

	const handleResizePointerDown =
		(handle: HandleId) => (event: ReactPointerEvent<HTMLDivElement>) => {
			if (event.button !== 0 || sentRef.current) {
				return;
			}

			const current = rectRef.current;
			if (!current) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			gestureRef.current = {
				type: "resize",
				handle,
				startRect: current,
				origin: pointFromEvent(event),
			};
			capturePointer(event);
		};

	const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		const gesture = gestureRef.current;
		if (!gesture) {
			return;
		}

		reportActivity();
		const point = pointFromEvent(event);
		if (gesture.type === "draw") {
			setRect(rectFromPoints(gesture.origin.x, gesture.origin.y, point.x, point.y));
			return;
		}

		const dx = point.x - gesture.origin.x;
		const dy = point.y - gesture.origin.y;
		if (gesture.type === "move") {
			if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) {
				gesture.moved = true;
			}
			setRect(
				clampRectToViewport({
					...gesture.startRect,
					x: gesture.startRect.x + dx,
					y: gesture.startRect.y + dy,
				}),
			);
			return;
		}

		setRect(resizeRect(gesture.startRect, gesture.handle, dx, dy));
	};

	const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
		const gesture = gestureRef.current;
		gestureRef.current = null;

		if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}

		if (!gesture) {
			return;
		}

		// A plain click on the frozen selection (no drag) is the quick confirm path.
		if (gesture.type === "move") {
			if (!gesture.moved) {
				setPhase("adjusting");
				confirm();
			}
			return;
		}

		if (gesture.type === "resize") {
			setPhase("adjusting");
			return;
		}

		const point = pointFromEvent(event);
		const selection = rectFromPoints(gesture.origin.x, gesture.origin.y, point.x, point.y);

		// A plain click is not a selection: drop it and let the user drag again.
		if (selection.width < MIN_SELECTION_SIZE || selection.height < MIN_SELECTION_SIZE) {
			setRect(null);
			setPhase("idle");
			return;
		}

		// Releasing the mouse freezes the selection; Enter or Confirm commits it.
		setRect(selection);
		setPhase("adjusting");
	};

	const sizeLabel =
		rect && rect.width >= 1 && rect.height >= 1
			? t("screenshot.regionSize", "{{width}} × {{height}}", {
					width: Math.round(rect.width),
					height: Math.round(rect.height),
				})
			: null;
	const labelTop = rect
		? clamp(
				rect.y + rect.height + 8 > window.innerHeight - 36
					? rect.y - 32
					: rect.y + rect.height + 8,
				0,
				Math.max(0, window.innerHeight - 28),
			)
		: 0;
	const actionsTop = rect
		? clamp(
				rect.y + rect.height + 10 > window.innerHeight - 44
					? Math.max(0, rect.y - 44)
					: rect.y + rect.height + 10,
				0,
				Math.max(0, window.innerHeight - 40),
			)
		: 0;

	return (
		<div
			className={styles.overlay}
			role="application"
			aria-label={t("screenshot.regionHint")}
			data-display-id={displayId ?? undefined}
			data-phase={phase}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
			onPointerCancel={handlePointerUp}
			onContextMenu={(event) => {
				event.preventDefault();
				cancel();
			}}
		>
			{!rect && <div className={styles.backdrop} />}

			{rect && (
				<div
					className={styles.selection}
					style={{
						left: rect.x,
						top: rect.y,
						width: rect.width,
						height: rect.height,
					}}
				>
					{phase === "adjusting" && (
						<>
							<div
								className={styles.moveSurface}
								onPointerDown={handleMovePointerDown}
								onDoubleClick={(event) => {
									event.preventDefault();
									confirm();
								}}
							/>
							{HANDLES.map((handle) => (
								<div
									key={handle}
									className={`${styles.handle} ${styles[HANDLE_CLASS_NAMES[handle]]}`}
									data-handle={handle}
									onPointerDown={handleResizePointerDown(handle)}
								/>
							))}
						</>
					)}
				</div>
			)}

			{rect && sizeLabel && (
				<div className={styles.sizeLabel} style={{ left: rect.x, top: labelTop }}>
					{sizeLabel}
				</div>
			)}

			{rect && phase === "adjusting" && (
				<div className={styles.actions} style={{ left: rect.x, top: actionsTop }}>
					<button
						type="button"
						className={styles.confirmButton}
						onPointerDown={(event) => event.stopPropagation()}
						onClick={(event) => {
							event.stopPropagation();
							confirm();
						}}
					>
						{t("screenshot.regionConfirmButton", "Confirm capture")}
					</button>
					<span className={styles.actionsHint}>
						{t("screenshot.regionAdjustHint", "Drag the handles to adjust")}
					</span>
				</div>
			)}

			<div className={styles.hint}>
				<span>
					{phase === "adjusting"
						? t("screenshot.regionAdjustHint", "Drag the handles to adjust")
						: t("screenshot.regionHint")}
				</span>
				<span className={styles.hintKeys}>{t("screenshot.regionConfirmHint")}</span>
				<span className={styles.hintKeys}>
					{t(
						"screenshot.regionQuickConfirmHint",
						"Double-click inside the selection to capture right away",
					)}
				</span>
				<span className={styles.hintKeys}>{t("screenshot.regionCancelHint")}</span>
			</div>
		</div>
	);
}
