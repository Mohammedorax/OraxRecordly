import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const started = new Set<number>();
	let nextId = 1;
	return {
		started,
		start: vi.fn(() => {
			const id = nextId++;
			started.add(id);
			return id;
		}),
		stop: vi.fn((id: number) => {
			started.delete(id);
		}),
		isStarted: vi.fn((id: number) => started.has(id)),
		reset() {
			started.clear();
			nextId = 1;
			this.start.mockClear();
			this.stop.mockClear();
			this.isStarted.mockClear();
		},
	};
});

vi.mock("electron", () => ({
	powerSaveBlocker: {
		start: mocks.start,
		stop: mocks.stop,
		isStarted: mocks.isStarted,
	},
}));

describe("export power guard", () => {
	beforeEach(() => {
		vi.resetModules();
		mocks.reset();
	});

	afterEach(() => {
		vi.resetModules();
	});

	it("blocks suspension for the first session and unblocks after the last", async () => {
		const guard = await import("./exportPowerGuard");

		guard.acquireExportActivity("stream:a");
		guard.acquireExportActivity("native:b");
		expect(mocks.start).toHaveBeenCalledTimes(1);
		expect(guard.getActiveExportActivityCount()).toBe(2);

		guard.releaseExportActivity("stream:a");
		expect(mocks.stop).not.toHaveBeenCalled();

		guard.releaseExportActivity("native:b");
		expect(mocks.stop).toHaveBeenCalledTimes(1);
		expect(guard.getActiveExportActivityCount()).toBe(0);
	});

	it("ignores an unknown token release and clears everything on demand", async () => {
		const guard = await import("./exportPowerGuard");

		guard.releaseExportActivity("never-acquired");
		expect(mocks.stop).not.toHaveBeenCalled();

		guard.acquireExportActivity("stream:a");
		guard.releaseExportPowerGuard();
		expect(guard.getActiveExportActivityCount()).toBe(0);
		expect(mocks.stop).toHaveBeenCalledTimes(1);
	});
});
