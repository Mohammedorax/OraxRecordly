import { expect, it } from "vitest";
import { isHudInEditorMode } from "./hudEditorMode";
it("allows New to prepare a recording despite an existing editor", () => {
	expect(isHudInEditorMode(1, false, false)).toBe(true);
	expect(isHudInEditorMode(1, true, false)).toBe(false);
	expect(isHudInEditorMode(1, true, true)).toBe(false);
	// Cancelling leaves the HUD ready to retry.
	expect(isHudInEditorMode(1, true, false)).toBe(false);
	// Returning Home stops idle preparation, but does not stop an active capture.
	expect(isHudInEditorMode(1, false, false)).toBe(true);
	expect(isHudInEditorMode(1, false, true)).toBe(false);
	expect(isHudInEditorMode(0, false, false)).toBe(false);
});
