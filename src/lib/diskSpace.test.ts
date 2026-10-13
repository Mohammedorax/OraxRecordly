import { describe, expect, it } from "vitest";
import {
	evaluateDiskSpace,
	formatBytesForMessage,
	LOW_FREE_BYTES_WARNING,
	MIN_FREE_BYTES_FOR_CAPTURE,
} from "./diskSpace";

describe("disk space preflight", () => {
	it("refuses when the volume is too full to hold a take", () => {
		expect(evaluateDiskSpace(MIN_FREE_BYTES_FOR_CAPTURE - 1)).toBe("insufficient");
		expect(evaluateDiskSpace(0)).toBe("insufficient");
	});

	it("warns in the band between the two thresholds", () => {
		expect(evaluateDiskSpace(MIN_FREE_BYTES_FOR_CAPTURE)).toBe("low");
		expect(evaluateDiskSpace(LOW_FREE_BYTES_WARNING - 1)).toBe("low");
		expect(evaluateDiskSpace(LOW_FREE_BYTES_WARNING)).toBe("ok");
		expect(evaluateDiskSpace(500 * 1024 * 1024 * 1024)).toBe("ok");
	});

	it("does not block on an unreadable volume", () => {
		expect(evaluateDiskSpace(null)).toBe("ok");
		expect(evaluateDiskSpace(undefined)).toBe("ok");
		expect(evaluateDiskSpace(Number.NaN)).toBe("ok");
	});

	it("formats sizes for the message", () => {
		expect(formatBytesForMessage(3.5 * 1024 * 1024 * 1024)).toBe("3.5 GB");
		expect(formatBytesForMessage(640 * 1024 * 1024)).toBe("640 MB");
		expect(formatBytesForMessage(0)).toBe("0 MB");
	});
});
