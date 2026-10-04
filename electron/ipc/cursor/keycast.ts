import { BrowserWindow } from "electron";
import {
	acceleratorToKeycastKeys,
	buildKeycastKeystroke,
	DEFAULT_KEYCAST_COALESCE_MS,
	isSuppressedKeycastStroke,
	type KeycastKeystroke,
	keycastKeyForKeycode,
	keycastModifierForKeycode,
	MAX_KEYCAST_EVENTS,
} from "../../../src/lib/keycast/keycastModel";
import {
	activeKeycastEvents,
	isCursorCaptureActive,
	keycastCaptureEnabled,
	keycastModifierState,
	pendingKeycastEvents,
	setActiveKeycastEvents,
	setKeycastModifierState,
	setPendingKeycastEvents,
} from "../state";
import type { HookEvent } from "../types";
import { getCursorCaptureElapsedMs, isCursorCapturePaused } from "./telemetry";

/**
 * Keystroke side of the existing global input hook.
 *
 * The recorder deliberately shares `interaction.ts`'s single uiohook instance
 * instead of opening a second global hook. It only stores anything while the
 * keycast overlay is enabled, and the events are written into the same
 * `*.cursor.json` telemetry file as the cursor samples — local only, never
 * uploaded.
 *
 * Platform note: `interaction.ts` never starts the uiohook event tap on macOS
 * (starting it can block Electron's main thread), so keycast capture is
 * Windows/Linux only with this pipeline. The overlay still renders from any
 * telemetry that already contains key events.
 */

function resolveKeycode(event: HookEvent | null | undefined): number | null {
	const keycode =
		event?.keycode ?? event?.data?.keycode ?? event?.rawcode ?? event?.data?.rawcode;
	return typeof keycode === "number" && Number.isFinite(keycode) ? keycode : null;
}

function emitLiveKeystroke(stroke: KeycastKeystroke) {
	BrowserWindow.getAllWindows().forEach((window) => {
		if (!window.isDestroyed()) {
			window.webContents.send("keycast-keystroke", stroke);
		}
	});
}

export function resetKeycastCapture() {
	setActiveKeycastEvents([]);
	setPendingKeycastEvents([]);
	setKeycastModifierState([]);
}

/**
 * Combinations the overlay must never paint, currently the app's own
 * system-wide screenshot accelerator: it is a Recordly trigger, not a lesson
 * shortcut.
 */
let suppressedCombos: string[][] = [];

/**
 * Register the app's own global shortcut so it is filtered out of the badge.
 * Applied whenever the keycast settings are pushed from a renderer (which
 * happens at start-up too), so the filter is in place before the first
 * recording.
 */
export function setKeycastSuppressedAccelerator(
	accelerator: string | null,
	isMac: boolean = process.platform === "darwin",
) {
	const keys = accelerator ? acceleratorToKeycastKeys(accelerator, isMac) : null;
	suppressedCombos = keys ? [keys] : [];
}

function replaceOrAppendKeystroke(stroke: KeycastKeystroke) {
	const previous = activeKeycastEvents[activeKeycastEvents.length - 1];
	const isRepeat =
		previous !== undefined &&
		previous.keys.length === stroke.keys.length &&
		previous.keys.every((key, index) => key === stroke.keys[index]) &&
		stroke.timeMs - previous.timeMs <= DEFAULT_KEYCAST_COALESCE_MS;

	if (isRepeat) {
		// Auto-repeat of a held key keeps one badge on screen and simply restarts
		// its visible window instead of stacking badges.
		previous.timeMs = stroke.timeMs;
		emitLiveKeystroke({ ...previous });
		return;
	}

	activeKeycastEvents.push(stroke);
	if (activeKeycastEvents.length > MAX_KEYCAST_EVENTS) {
		activeKeycastEvents.shift();
	}
	emitLiveKeystroke(stroke);
}

/** Feed one uiohook keyboard event into the keycast telemetry. */
export function recordKeycastHookEvent(eventName: "keydown" | "keyup", event: HookEvent) {
	if (!keycastCaptureEnabled || !isCursorCaptureActive || isCursorCapturePaused()) {
		return;
	}

	const keycode = resolveKeycode(event);
	if (keycode === null) {
		return;
	}

	const modifier = keycastModifierForKeycode(keycode);
	if (modifier) {
		const held = new Set(keycastModifierState);
		if (eventName === "keydown") {
			held.add(modifier);
		} else {
			held.delete(modifier);
		}
		setKeycastModifierState([...held]);
		return;
	}

	if (eventName !== "keydown") {
		return;
	}

	const key = keycastKeyForKeycode(keycode);
	if (!key) {
		return;
	}

	// Modifier-only presses never reach here: a badge is only produced once a
	// real key is pressed with (or without) modifiers held.
	const stroke = buildKeycastKeystroke(getCursorCaptureElapsedMs(), keycastModifierState, key);
	if (!stroke) {
		return;
	}

	if (isSuppressedKeycastStroke(stroke.keys, suppressedCombos)) {
		return;
	}

	replaceOrAppendKeystroke(stroke);
}

/**
 * Move the in-flight keystrokes into the pending buffer. Called from the same
 * place as `snapshotCursorTelemetryForPersistence` so a pause boundary or a
 * stop cannot drop keystrokes that were recorded after the previous snapshot.
 */
export function snapshotKeycastTelemetryForPersistence() {
	if (activeKeycastEvents.length === 0) {
		return;
	}

	if (pendingKeycastEvents.length === 0) {
		setPendingKeycastEvents([...activeKeycastEvents]);
		return;
	}

	const lastPendingTimeMs = pendingKeycastEvents[pendingKeycastEvents.length - 1]?.timeMs ?? -1;
	setPendingKeycastEvents([
		...pendingKeycastEvents,
		...activeKeycastEvents.filter((event) => event.timeMs > lastPendingTimeMs),
	]);
}
