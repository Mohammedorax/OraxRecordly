import { describe, expect, it } from "vitest";
import { buildWindowsWindowForwardScript } from "./windowsWindowControl";

describe("bringing the selected window forward", () => {
	const script = buildWindowsWindowForwardScript();

	it("restores a minimized window with SW_RESTORE and raises it", () => {
		expect(script).toContain("IsIconic");
		expect(script).toContain("ShowWindowAsync($handle, 9)");
		expect(script).toContain("if ($needsRaise)");
	});

	it("shows a hidden window instead of capturing an empty frame", () => {
		expect(script).toContain("IsWindowVisible");
		expect(script).toContain("ShowWindowAsync($handle, 5)");
	});

	it("never steals focus from an already visible window", () => {
		// Windows Graphics Capture records an occluded window, so raising it would
		// only pull focus away from the user's foreground app.
		expect(script).not.toMatch(/\n\[RecordlyForegroundWindow\]::SetForegroundWindow/);
	});
});
