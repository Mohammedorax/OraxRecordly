import { beforeEach, describe, expect, it, vi } from "vitest";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("electron", () => ({
	BrowserWindow: {
		getAllWindows: () => [{ isDestroyed: () => false, webContents: { send } }],
	},
	app: {
		getPath: vi.fn(() => "/tmp"),
	},
}));

vi.mock("../utils", () => ({
	getTelemetryPathForVideo: vi.fn(() => "/tmp/recording.cursor.json"),
	getScreen: vi.fn(() => ({
		getCursorScreenPoint: () => ({ x: 0, y: 0 }),
		getPrimaryDisplay: () => ({ scaleFactor: 1 }),
		getDisplayNearestPoint: () => ({ bounds: { x: 0, y: 0, width: 1, height: 1 } }),
		getAllDisplays: () => [],
	})),
}));

import {
	activeKeycastEvents,
	keycastModifierState,
	setActiveCursorSamples,
	setCursorCaptureAccumulatedPausedMs,
	setCursorCapturePauseStartedAtMs,
	setCursorCaptureStartTimeMs,
	setIsCursorCaptureActive,
	setKeycastCaptureEnabled,
} from "../state";
import {
	recordKeycastHookEvent,
	resetKeycastCapture,
	setKeycastSuppressedAccelerator,
} from "./keycast";

/** uiohook virtual key codes used by the fixture. */
const KEY = {
	ctrlLeft: 0x001d,
	shiftLeft: 0x002a,
	a: 0x001e,
	c: 0x002e,
	t: 0x0014,
} as const;

function press(keycode: number) {
	recordKeycastHookEvent("keydown", { keycode });
}

function release(keycode: number) {
	recordKeycastHookEvent("keyup", { keycode });
}

describe("keycast hook recorder", () => {
	beforeEach(() => {
		send.mockReset();
		resetKeycastCapture();
		setKeycastSuppressedAccelerator(null);
		setCursorCaptureStartTimeMs(Date.now() - 1_000);
		setCursorCaptureAccumulatedPausedMs(0);
		setCursorCapturePauseStartedAtMs(null);
		setActiveCursorSamples([]);
		setIsCursorCaptureActive(true);
		setKeycastCaptureEnabled(true);
	});

	it("records nothing while the overlay is disabled", () => {
		setKeycastCaptureEnabled(false);
		press(KEY.ctrlLeft);
		press(KEY.a);

		expect(activeKeycastEvents).toEqual([]);
		expect(send).not.toHaveBeenCalled();
	});

	it("records nothing while cursor capture is inactive or paused", () => {
		setIsCursorCaptureActive(false);
		press(KEY.a);
		expect(activeKeycastEvents).toEqual([]);

		setIsCursorCaptureActive(true);
		setCursorCapturePauseStartedAtMs(Date.now());
		press(KEY.a);
		expect(activeKeycastEvents).toEqual([]);
	});

	it("ignores modifier-only presses", () => {
		press(KEY.ctrlLeft);
		press(KEY.shiftLeft);

		expect(keycastModifierState).toEqual(["Ctrl", "Shift"]);
		expect(activeKeycastEvents).toEqual([]);
		expect(send).not.toHaveBeenCalled();
	});

	it("composes the held modifiers with the real key and broadcasts it live", () => {
		press(KEY.ctrlLeft);
		press(KEY.shiftLeft);
		press(KEY.a);

		expect(activeKeycastEvents).toHaveLength(1);
		expect(activeKeycastEvents[0].keys).toEqual(["Ctrl", "Shift", "A"]);
		expect(activeKeycastEvents[0].timeMs).toBeGreaterThanOrEqual(900);
		expect(send).toHaveBeenCalledWith("keycast-keystroke", activeKeycastEvents[0]);
	});

	it("drops a released modifier from the next badge", () => {
		press(KEY.ctrlLeft);
		press(KEY.a);
		release(KEY.ctrlLeft);
		press(KEY.c);

		expect(activeKeycastEvents.map((event) => event.keys)).toEqual([["Ctrl", "A"], ["C"]]);
	});

	it("coalesces OS auto-repeat of a held combination", () => {
		press(KEY.a);
		const firstTime = activeKeycastEvents[0].timeMs;
		press(KEY.a);
		press(KEY.a);

		expect(activeKeycastEvents).toHaveLength(1);
		expect(activeKeycastEvents[0].timeMs).toBeGreaterThanOrEqual(firstTime);
	});

	it("ignores key-ups for real keys and unmapped key codes", () => {
		release(KEY.a);
		press(0x7fff);

		expect(activeKeycastEvents).toEqual([]);
	});

	it("keeps the app's own global shortcut out of the badge", () => {
		setKeycastSuppressedAccelerator("CommandOrControl+Alt+A", false);
		press(0x0038);
		press(KEY.ctrlLeft);
		press(KEY.a);

		expect(activeKeycastEvents).toEqual([]);

		// A different combination is still recorded afterwards.
		release(0x0038);
		press(KEY.c);
		expect(activeKeycastEvents.map((event) => event.keys)).toEqual([["Ctrl", "C"]]);
	});
});
