import { describe, expect, it } from "vitest";
import {
	CRASH_RECOVERY_WINDOW_MS,
	decideRendererCrashRecovery,
	isRendererCrashReason,
	MAX_CRASH_RECOVERIES,
} from "./rendererCrashRecovery";

describe("renderer crash recovery", () => {
	it("reloads once for a real crash", () => {
		const decision = decideRendererCrashRecovery({
			history: [],
			now: 1_000,
			reason: "crashed",
		});

		expect(decision.reload).toBe(true);
		expect(decision.history).toEqual([{ at: 1_000 }]);
	});

	it("never reloads after a clean exit", () => {
		const decision = decideRendererCrashRecovery({
			history: [{ at: 1_000 }],
			now: 2_000,
			reason: "clean-exit",
		});

		expect(decision.reload).toBe(false);
		expect(decision.history).toEqual([{ at: 1_000 }]);
	});

	it("stops reloading after the budget is spent, so a crash loop cannot spin", () => {
		let history: { at: number }[] = [];
		let reloads = 0;

		for (let attempt = 0; attempt < 5; attempt += 1) {
			const decision = decideRendererCrashRecovery({
				history,
				now: 1_000 + attempt * 1_000,
				reason: "crashed",
			});
			history = decision.history;
			if (decision.reload) reloads += 1;
		}

		expect(reloads).toBe(MAX_CRASH_RECOVERIES);
	});

	it("forgets old crashes once the window has passed", () => {
		const decision = decideRendererCrashRecovery({
			history: [{ at: 0 }, { at: 1 }],
			now: CRASH_RECOVERY_WINDOW_MS + 10_000,
			reason: "crashed",
		});

		expect(decision.reload).toBe(true);
		expect(decision.history).toEqual([{ at: CRASH_RECOVERY_WINDOW_MS + 10_000 }]);
	});

	it("treats a missing reason as unknown, not as a crash", () => {
		expect(isRendererCrashReason(undefined)).toBe(false);
		expect(isRendererCrashReason("")).toBe(false);
		expect(isRendererCrashReason("oom")).toBe(true);
		expect(decideRendererCrashRecovery({ history: [], now: 1, reason: undefined }).reload).toBe(
			false,
		);
	});
});
