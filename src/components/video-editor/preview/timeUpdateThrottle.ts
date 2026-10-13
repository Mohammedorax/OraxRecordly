/**
 * Coalesces high-frequency playback time updates before they reach React.
 *
 * The transport reports the playhead position on every animation frame. Passing
 * each of those straight into editor state re-rendered the whole editor ~60 times
 * a second, which is felt as stutter while editing a large timeline. The preview
 * itself keeps drawing at full rate (it has its own ticker); only the React-visible
 * time is throttled.
 *
 * The last value is never dropped: a trailing update fires once the interval has
 * passed, so pausing or seeking lands on the exact time.
 */

export interface TimeUpdateThrottleOptions {
	/** Minimum time between two updates that reach the consumer. */
	minIntervalMs?: number;
	/** Updates smaller than this are ignored unless the interval has passed. */
	minDeltaMs?: number;
	onUpdate: (timeMs: number) => void;
	/** Injectable for tests. */
	now?: () => number;
	schedule?: (callback: () => void, delayMs: number) => number;
	cancel?: (handle: number) => void;
}

export interface TimeUpdateThrottle {
	/** Feeds a new time; may call `onUpdate` immediately or after the interval. */
	push: (timeMs: number) => void;
	/** Applies the pending value right away (used when playback ends). */
	flush: () => void;
	/** Cancels any pending update. */
	dispose: () => void;
}

const DEFAULT_MIN_INTERVAL_MS = 33;
const DEFAULT_MIN_DELTA_MS = 0;

export function createTimeUpdateThrottle(options: TimeUpdateThrottleOptions): TimeUpdateThrottle {
	const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
	const minDeltaMs = options.minDeltaMs ?? DEFAULT_MIN_DELTA_MS;
	const now = options.now ?? (() => performance.now());
	const schedule =
		options.schedule ??
		((callback, delayMs) => setTimeout(callback, delayMs) as unknown as number);
	const cancel = options.cancel ?? ((handle) => clearTimeout(handle));

	let lastSentAt = Number.NEGATIVE_INFINITY;
	let lastSentValue: number | null = null;
	let pending: number | null = null;
	let pendingHandle: number | null = null;

	const clearPending = () => {
		if (pendingHandle !== null) {
			cancel(pendingHandle);
			pendingHandle = null;
		}
	};

	const send = (timeMs: number) => {
		clearPending();
		pending = null;
		lastSentAt = now();
		lastSentValue = timeMs;
		options.onUpdate(timeMs);
	};

	const armTrailing = () => {
		if (pendingHandle !== null) {
			return;
		}

		const elapsed = now() - lastSentAt;
		const delay = Math.max(0, minIntervalMs - elapsed);
		pendingHandle = schedule(() => {
			pendingHandle = null;
			if (pending !== null) {
				send(pending);
			}
		}, delay);
	};

	return {
		push(timeMs: number) {
			if (!Number.isFinite(timeMs)) {
				return;
			}

			const elapsed = now() - lastSentAt;
			const moved = lastSentValue === null || Math.abs(timeMs - lastSentValue) >= minDeltaMs;
			if (elapsed >= minIntervalMs && moved) {
				send(timeMs);
				return;
			}

			pending = timeMs;
			armTrailing();
		},
		flush() {
			if (pending !== null) {
				send(pending);
			}
		},
		dispose() {
			clearPending();
			pending = null;
		},
	};
}
