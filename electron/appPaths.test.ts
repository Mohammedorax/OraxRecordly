import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDefaultExportDir, getRecordingCacheDir } from "./appPaths";

/**
 * Layout contract, asked for directly: the recordings root is where a user finds
 * finished videos, while the generated footage lives in a cache folder beside it.
 * Moving either folder silently would scatter someone's library, so it is pinned.
 */
describe("recordings folder layout", () => {
	it("writes finished exports to the recordings root", () => {
		expect(getDefaultExportDir("C:\\Videos\\OraxRecordly")).toBe("C:\\Videos\\OraxRecordly");
	});

	it("keeps raw footage in a cache folder inside the root", () => {
		expect(getRecordingCacheDir(path.join("Videos", "OraxRecordly"))).toBe(
			path.join("Videos", "OraxRecordly", "Cache"),
		);
		expect(path.basename(getRecordingCacheDir())).toBe("Cache");
	});
});
