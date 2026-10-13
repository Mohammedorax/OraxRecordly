import { afterEach, describe, expect, it, vi } from "vitest";
import { getFallbackFontFamilies, getPlatformKey, loadSystemFontFamilies } from "./systemFonts";

const originalQuery = (globalThis as { queryLocalFonts?: unknown }).queryLocalFonts;

afterEach(() => {
	if (originalQuery === undefined) {
		delete (globalThis as { queryLocalFonts?: unknown }).queryLocalFonts;
	} else {
		(globalThis as { queryLocalFonts?: unknown }).queryLocalFonts = originalQuery;
	}
});

describe("getPlatformKey", () => {
	it("maps the platform strings Electron reports", () => {
		expect(getPlatformKey("Win32")).toBe("win32");
		expect(getPlatformKey("MacIntel")).toBe("darwin");
		expect(getPlatformKey("Linux x86_64")).toBe("linux");
	});

	it("assumes Windows when the platform is unknown", () => {
		expect(getPlatformKey(undefined)).toBe("win32");
		expect(getPlatformKey("")).toBe("win32");
	});
});

describe("getFallbackFontFamilies", () => {
	it("returns fonts that ship with each platform", () => {
		expect(getFallbackFontFamilies("Win32")).toContain("Segoe UI");
		expect(getFallbackFontFamilies("MacIntel")).toContain("Helvetica");
		expect(getFallbackFontFamilies("Linux x86_64")).toContain("DejaVu Sans");
	});
});

describe("loadSystemFontFamilies", () => {
	it("uses the device list when the browser exposes it", async () => {
		(globalThis as { queryLocalFonts?: unknown }).queryLocalFonts = vi
			.fn()
			.mockResolvedValue([
				{ family: "Zeta Sans" },
				{ family: "Alpha Sans" },
				{ family: "Alpha Sans" },
				{ family: "  " },
				{},
			]);

		await expect(loadSystemFontFamilies("Win32")).resolves.toEqual(["Alpha Sans", "Zeta Sans"]);
	});

	it("falls back to the platform list when the API is unavailable", async () => {
		delete (globalThis as { queryLocalFonts?: unknown }).queryLocalFonts;

		await expect(loadSystemFontFamilies("Win32")).resolves.toContain("Segoe UI");
	});

	it("falls back when enumeration is refused", async () => {
		(globalThis as { queryLocalFonts?: unknown }).queryLocalFonts = vi
			.fn()
			.mockRejectedValue(new Error("permission denied"));

		await expect(loadSystemFontFamilies("MacIntel")).resolves.toContain("Helvetica");
	});

	it("falls back when the device reports no readable font", async () => {
		(globalThis as { queryLocalFonts?: unknown }).queryLocalFonts = vi
			.fn()
			.mockResolvedValue([]);

		await expect(loadSystemFontFamilies("Linux x86_64")).resolves.toContain("DejaVu Sans");
	});
});
