import { describe, expect, it, vi } from "vitest";
import { subscribeToRecordingActivity } from "./useRecordingActivity";

describe("recording activity subscription", () => {
	it("reports the recording state and forwards the unsubscribe", () => {
		let listener: ((state: { recording: boolean; sourceName: string }) => void) | null = null;
		const unsubscribe = vi.fn();
		const subscribe = vi.fn(
			(next: (state: { recording: boolean; sourceName: string }) => void) => {
				listener = next;
				return unsubscribe;
			},
		);
		const onStateChange = vi.fn();

		const stop = subscribeToRecordingActivity(subscribe, onStateChange);
		listener?.({ recording: true, sourceName: "Display 1" });

		expect(onStateChange).toHaveBeenCalledWith(true);

		stop();
		expect(unsubscribe).toHaveBeenCalledTimes(1);
	});

	it("is inert when the bridge is missing", () => {
		const onStateChange = vi.fn();
		const stop = subscribeToRecordingActivity(undefined, onStateChange);

		expect(onStateChange).not.toHaveBeenCalled();
		expect(() => stop()).not.toThrow();
	});
});
