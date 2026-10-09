import { describe, expect, it } from "vitest";
import { RECORDINGS_DIR } from "../appPaths";
import { decideRecordingsMigration } from "./recordingDirMigration";

const baseInput = {
	customDir: null,
	targetDir: "C:\\Users\\me\\Videos\\OraxRecordly",
	legacyExists: true,
	legacyEntryCount: 3,
	targetExists: false,
	targetEntryCount: 0,
	alreadyMigrated: false,
};

describe("recordings directory migration policy", () => {
	it("moves the library when legacy data exists and the target is free", () => {
		expect(decideRecordingsMigration(baseInput)).toBe("move");
	});

	it("treats an existing empty target as free", () => {
		expect(
			decideRecordingsMigration({ ...baseInput, targetExists: true, targetEntryCount: 0 }),
		).toBe("move");
	});

	it("is a no-op on a fresh install with nothing to carry over", () => {
		expect(
			decideRecordingsMigration({ ...baseInput, legacyExists: false, legacyEntryCount: 0 }),
		).toBe("use-target");
		expect(decideRecordingsMigration({ ...baseInput, legacyEntryCount: 0 })).toBe("use-target");
	});

	it("never merges into a target that already holds files", () => {
		expect(
			decideRecordingsMigration({ ...baseInput, targetExists: true, targetEntryCount: 2 }),
		).toBe("stay-legacy");
	});

	it("respects a user-chosen folder and the legacy default", () => {
		expect(decideRecordingsMigration({ ...baseInput, customDir: "D:\\clips" })).toBe(
			"use-target",
		);
		expect(decideRecordingsMigration({ ...baseInput, targetDir: RECORDINGS_DIR })).toBe(
			"use-target",
		);
	});

	it("runs only once", () => {
		expect(decideRecordingsMigration({ ...baseInput, alreadyMigrated: true })).toBe(
			"use-target",
		);
	});
});
