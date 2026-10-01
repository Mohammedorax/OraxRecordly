import { type PointerEvent, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import {
	mergeHudInteractiveBounds,
	shouldRestoreHudMousePassthroughAfterDrag,
} from "../hudMousePassthrough";

/**
 * Drags the compact HUD window itself.
 *
 * The HUD window is no longer desktop-sized, so the bar cannot be moved by
 * translating it inside the window: the renderer reports the pointer position
 * and the main process moves the window (`hud-overlay-drag`), clamping it to the
 * visible work area. Linux is the exception — Wayland ignores programmatic
 * window placement, so the drag handle stays `-webkit-app-region: drag` there
 * and the compositor moves the window.
 */
export function useHudBarDrag({
	hudContentRef,
	hudBarRef,
	useWindowDrag,
}: {
	hudContentRef: RefObject<HTMLDivElement | null>;
	hudBarRef: RefObject<HTMLDivElement | null>;
	/** Move the native window through the `hud-overlay-drag` IPC channel. */
	useWindowDrag: boolean;
}) {
	const [isHudDragging, setIsHudDragging] = useState(false);
	const isHudDraggingRef = useRef(false);
	const hudDragPointerIdRef = useRef<number | null>(null);
	// Pointer events can arrive in bursts (high-polling mice, a busy main thread
	// releasing several queued moves at once). Only the newest position matters:
	// forwarding every one of them would ask the main process to move a native
	// window several times per frame.
	const pendingWindowMoveRef = useRef<{ screenX: number; screenY: number } | null>(null);
	const windowMoveFrameRef = useRef<number | null>(null);

	const cancelPendingWindowMove = useCallback(() => {
		if (windowMoveFrameRef.current !== null) {
			window.cancelAnimationFrame(windowMoveFrameRef.current);
			windowMoveFrameRef.current = null;
		}
		pendingWindowMoveRef.current = null;
	}, []);

	const sendWindowMove = useCallback((screenX: number, screenY: number) => {
		window.electronAPI?.hudOverlayDrag?.("move", screenX, screenY);
	}, []);

	const scheduleWindowMove = useCallback(
		(screenX: number, screenY: number) => {
			pendingWindowMoveRef.current = { screenX, screenY };
			if (windowMoveFrameRef.current !== null) {
				return;
			}

			windowMoveFrameRef.current = window.requestAnimationFrame(() => {
				windowMoveFrameRef.current = null;
				const pending = pendingWindowMoveRef.current;
				pendingWindowMoveRef.current = null;
				if (!pending) {
					return;
				}
				sendWindowMove(pending.screenX, pending.screenY);
			});
		},
		[sendWindowMove],
	);

	// The end of a gesture must not drop the last queued position.
	const flushPendingWindowMove = useCallback(
		(screenX: number, screenY: number) => {
			const hadPending = pendingWindowMoveRef.current !== null;
			cancelPendingWindowMove();
			if (hadPending) {
				sendWindowMove(screenX, screenY);
			}
		},
		[cancelPendingWindowMove, sendWindowMove],
	);

	const endWindowDrag = useCallback(
		(screenX: number, screenY: number) => {
			if (!useWindowDrag) {
				return;
			}

			window.electronAPI?.hudOverlayDrag?.("end", screenX, screenY);
		},
		[useWindowDrag],
	);

	const handleHudBarPointerDown = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			if (event.button !== 0) {
				return;
			}

			event.preventDefault();
			event.currentTarget.setPointerCapture(event.pointerId);
			cancelPendingWindowMove();
			isHudDraggingRef.current = true;
			hudDragPointerIdRef.current = event.pointerId;
			setIsHudDragging(true);
			// Keep the window interactive for the whole gesture so the pointer
			// cannot fall through to the application behind the bar.
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
			if (useWindowDrag) {
				window.electronAPI?.hudOverlayDrag?.("start", event.screenX, event.screenY);
			}
		},
		[cancelPendingWindowMove, useWindowDrag],
	);

	const handleHudBarPointerMove = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			if (!isHudDraggingRef.current || hudDragPointerIdRef.current !== event.pointerId) {
				return;
			}

			if (!useWindowDrag) {
				return;
			}

			scheduleWindowMove(event.screenX, event.screenY);
		},
		[scheduleWindowMove, useWindowDrag],
	);

	const handleHudBarPointerUp = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			if (!isHudDraggingRef.current || hudDragPointerIdRef.current !== event.pointerId) {
				return;
			}

			hudDragPointerIdRef.current = null;
			// Apply the position of the last queued frame before closing the
			// gesture, otherwise the window stops short of the pointer and the
			// main process remembers that stale spot.
			flushPendingWindowMove(event.screenX, event.screenY);
			endWindowDrag(event.screenX, event.screenY);

			const wasDragging = isHudDraggingRef.current;
			isHudDraggingRef.current = false;
			setIsHudDragging(false);
			if (event.currentTarget.hasPointerCapture(event.pointerId)) {
				event.currentTarget.releasePointerCapture(event.pointerId);
			}

			// The bar did not move inside the window, so the pointer is normally
			// still on it and the pointer-leave handler restores passthrough.
			const hudBounds = mergeHudInteractiveBounds(
				[
					hudContentRef.current?.getBoundingClientRect(),
					hudBarRef.current?.getBoundingClientRect(),
				].map((bounds) =>
					bounds
						? {
								left: bounds.left,
								top: bounds.top,
								right: bounds.right,
								bottom: bounds.bottom,
							}
						: null,
				),
			);
			if (
				wasDragging &&
				shouldRestoreHudMousePassthroughAfterDrag(hudBounds, event.clientX, event.clientY)
			) {
				window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
			}
		},
		[endWindowDrag, flushPendingWindowMove, hudBarRef, hudContentRef],
	);

	useEffect(() => {
		return () => {
			cancelPendingWindowMove();
			// An interrupted drag (unmount/close) must not leave the main process
			// tracking a gesture that will never end.
			if (isHudDraggingRef.current) {
				endWindowDrag(0, 0);
			}
			isHudDraggingRef.current = false;
			hudDragPointerIdRef.current = null;
		};
	}, [cancelPendingWindowMove, endWindowDrag]);

	return {
		isHudDragging,
		isHudDraggingRef,
		handleHudBarPointerDown,
		handleHudBarPointerMove,
		handleHudBarPointerUp,
	};
}
