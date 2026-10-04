import { beforeEach, describe, expect, it, vi } from "vitest";
import { CURSOR_TELEMETRY_VERSION } from "../constants";

const { writeFile, rm, readFile } = vi.hoisted(() => ({
	writeFile: vi.fn(),
	rm: vi.fn(),
	readFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
	default: {
		writeFile,
		rm,
		readFile,
	},
}));

vi.mock("electron", () => ({
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

import { activeCursorSamples, setActiveCursorSamples, setCursorCaptureStartTimeMs } from "../state";
import {
	getCursorCaptureElapsedMs,
	normalizeCursorTelemetrySamples,
	pauseCursorCapture,
	pauseCursorCaptureAtBoundary,
	pushCursorSample,
	resetCursorCaptureClock,
	resumeCursorCapture,
	writeCursorTelemetry,
} from "./telemetry";

describe("cursor telemetry pause clock", () => {
	beforeEach(() => {
		writeFile.mockReset();
		rm.mockReset();
		readFile.mockReset();
		// No sidecar on disk unless a test says otherwise.
		readFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
		setCursorCaptureStartTimeMs(1_000);
		setActiveCursorSamples([]);
		resetCursorCaptureClock();
	});

	it("subtracts paused time from elapsed cursor timestamps", () => {
		expect(getCursorCaptureElapsedMs(1_120)).toBe(120);

		pauseCursorCapture(1_200);
		expect(getCursorCaptureElapsedMs(1_450)).toBe(200);

		resumeCursorCapture(1_700);
		expect(getCursorCaptureElapsedMs(1_900)).toBe(400);
	});

	it("ignores duplicate pause or resume transitions", () => {
		pauseCursorCapture(1_150);
		pauseCursorCapture(1_250);
		resumeCursorCapture(1_500);
		resumeCursorCapture(1_650);

		expect(getCursorCaptureElapsedMs(1_900)).toBe(550);
	});

	it("drops cursor samples captured after the renderer pause boundary", () => {
		pushCursorSample(0.1, 0.1, 120, "move");
		pushCursorSample(0.2, 0.2, 205, "move");
		pushCursorSample(0.3, 0.3, 260, "move");

		pauseCursorCaptureAtBoundary(1_200);

		expect(getCursorCaptureElapsedMs(1_500)).toBe(200);
		expect(activeCursorSamples.map((sample) => sample.timeMs)).toEqual([120]);

		resumeCursorCapture(1_700);
		expect(getCursorCaptureElapsedMs(1_900)).toBe(400);
	});

	it("normalizes cursor telemetry samples before persisting them", async () => {
		const samples = normalizeCursorTelemetrySamples([
			{ timeMs: 30, cx: 2, cy: -1, interactionType: "click", cursorType: "pointer" },
			{ timeMs: -10, cx: Number.NaN, cy: 0.2, interactionType: "drag", cursorType: "ibeam" },
			{ timeMs: 10, cx: 0.25, cy: 0.75, interactionType: "move", cursorType: "text" },
		]);

		expect(samples).toEqual([
			{ timeMs: 0, cx: 0.5, cy: 0.2, interactionType: undefined, cursorType: undefined },
			{ timeMs: 10, cx: 0.25, cy: 0.75, interactionType: "move", cursorType: "text" },
			{ timeMs: 30, cx: 1, cy: 0, interactionType: "click", cursorType: "pointer" },
		]);

		await writeCursorTelemetry("/tmp/recording.mp4", samples);

		expect(writeFile).toHaveBeenCalledWith(
			"/tmp/recording.cursor.json",
			JSON.stringify(
				{
					version: CURSOR_TELEMETRY_VERSION,
					samples,
					keyEvents: [],
				},
				null,
				2,
			),
			"utf-8",
		);
		expect(rm).not.toHaveBeenCalled();
	});

	it("persists keycast keystrokes next to the cursor samples", async () => {
		await writeCursorTelemetry(
			"/tmp/recording.mp4",
			[],
			[
				{ timeMs: 40, keys: ["Ctrl", "A"] },
				{ timeMs: 5, keys: ["Ctrl", "A"] },
				{ timeMs: "nope", keys: ["Ctrl", "A"] },
			],
		);

		expect(writeFile).toHaveBeenCalledWith(
			"/tmp/recording.cursor.json",
			JSON.stringify(
				{
					version: CURSOR_TELEMETRY_VERSION,
					samples: [],
					// Sorted, invalid entries dropped, and the rapid repeat coalesced
					// onto the newest press by the shared keycast model.
					keyEvents: [{ timeMs: 40, keys: ["Ctrl", "A"] }],
				},
				null,
				2,
			),
			"utf-8",
		);
	});

	it("keeps keycast keystrokes already on disk when only samples are rewritten", async () => {
		readFile.mockResolvedValue(
			JSON.stringify({ keyEvents: [{ timeMs: 12, keys: ["Ctrl", "Shift", "T"] }] }),
		);

		await writeCursorTelemetry("/tmp/recording.mp4", [{ timeMs: 1, cx: 0.5, cy: 0.5 }]);

		const [, payload] = writeFile.mock.calls[0];
		expect(JSON.parse(payload).keyEvents).toEqual([
			{ timeMs: 12, keys: ["Ctrl", "Shift", "T"] },
		]);
	});

	it("removes the sidecar when saving an empty cursor telemetry payload", async () => {
		await writeCursorTelemetry("/tmp/recording.mp4", []);

		expect(rm).toHaveBeenCalledWith("/tmp/recording.cursor.json", { force: true });
		expect(writeFile).not.toHaveBeenCalled();
	});
});
