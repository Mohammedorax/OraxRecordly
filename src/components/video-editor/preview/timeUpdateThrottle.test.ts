import { describe, expect, it } from "vitest";
import { createTimeUpdateThrottle } from "./timeUpdateThrottle";

/** Deterministic clock and timer queue for the throttle. */
function createHarness(minIntervalMs = 33, minDeltaMs = 0) {
	let currentTime = 0;
	const timers: Array<{ id: number; at: number; callback: () => void }> = [];
	let nextId = 1;
	const updates: number[] = [];

	const throttle = createTimeUpdateThrottle({
		minIntervalMs,
		minDeltaMs,
		onUpdate: (timeMs) => updates.push(timeMs),
		now: () => currentTime,
		schedule: (callback, delayMs) => {
			const id = nextId++;
			timers.push({ id, at: currentTime + delayMs, callback });
			return id;
		},
		cancel: (handle) => {
			const index = timers.findIndex((timer) => timer.id === handle);
			if (index !== -1) {
				timers.splice(index, 1);
			}
		},
	});

	const advance = (ms: number) => {
		currentTime += ms;
		for (;;) {
			const due = timers
				.filter((timer) => timer.at <= currentTime)
				.sort((a, b) => a.at - b.at);
			if (due.length === 0) break;
			for (const timer of due) {
				timers.splice(timers.indexOf(timer), 1);
				timer.callback();
			}
		}
	};

	return { throttle, updates, advance, at: () => currentTime };
}

describe("playback time throttle", () => {
	it("passes the first update straight through", () => {
		const harness = createHarness();

		harness.throttle.push(100);
		expect(harness.updates).toEqual([100]);
	});

	it("coalesces frames inside the interval and applies the newest one", () => {
		const harness = createHarness(33);

		harness.throttle.push(0); // sent immediately
		harness.advance(10);
		harness.throttle.push(10);
		harness.advance(5);
		harness.throttle.push(15);
		expect(harness.updates).toEqual([0]);

		// The trailing update fires once the interval has passed, with the last value.
		harness.advance(20);
		expect(harness.updates).toEqual([0, 15]);
	});

	it("emits at most one update per interval during a steady stream", () => {
		const harness = createHarness(33);

		// 60 frames per second for one second.
		for (let frame = 0; frame < 60; frame += 1) {
			harness.throttle.push(frame * 16.7);
			harness.advance(16.7);
		}
		harness.throttle.flush();

		// ~30 updates instead of 60, and the last value is exact.
		expect(harness.updates.length).toBeLessThanOrEqual(31);
		expect(harness.updates.at(-1)).toBeCloseTo(59 * 16.7, 5);
	});

	it("never loses the final value when playback stops mid-interval", () => {
		const harness = createHarness(33);

		harness.throttle.push(0);
		harness.advance(5);
		harness.throttle.push(5);
		harness.throttle.flush();

		expect(harness.updates).toEqual([0, 5]);
	});

	it("ignores sub-threshold movement until the trailing update", () => {
		const harness = createHarness(0, 25);

		harness.throttle.push(1_000);
		harness.throttle.push(1_010);
		// 10 ms is below the 25 ms threshold, so no second render is asked for yet.
		expect(harness.updates).toEqual([1_000]);

		// The pending value is still applied by the trailing update, so slow movement
		// keeps up instead of being dropped.
		harness.advance(1);
		expect(harness.updates).toEqual([1_000, 1_010]);

		harness.throttle.push(1_040);
		expect(harness.updates).toEqual([1_000, 1_010, 1_040]);
	});

	it("drops a pending value that is disposed before it fires", () => {
		const harness = createHarness(33);

		harness.throttle.push(0);
		harness.throttle.push(20);
		harness.throttle.dispose();
		harness.advance(100);

		expect(harness.updates).toEqual([0]);
	});

	it("ignores non-finite values", () => {
		const harness = createHarness();

		harness.throttle.push(Number.NaN);
		harness.throttle.push(Number.POSITIVE_INFINITY);
		expect(harness.updates).toEqual([]);
	});
});
