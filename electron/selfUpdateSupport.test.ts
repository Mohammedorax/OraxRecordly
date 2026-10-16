import { describe, expect, it } from "vitest";
import { isSelfUpdateSupported } from "./selfUpdateSupport";

describe("isSelfUpdateSupported", () => {
	it("lets an installed Windows build replace itself", () => {
		expect(isSelfUpdateSupported({ platform: "win32" })).toBe(true);
	});

	it("does not promise the portable Windows build an update it cannot install", () => {
		expect(
			isSelfUpdateSupported({
				platform: "win32",
				portableExecutableDir: "C:\\Users\\u\\Desktop\\OraxRecordly",
			}),
		).toBe(false);
	});

	it("lets an AppImage update itself", () => {
		expect(
			isSelfUpdateSupported({
				platform: "linux",
				appImagePath: "/home/u/Apps/OraxRecordly-linux-x64.AppImage",
			}),
		).toBe(true);
	});

	it("does not promise a deb or rpm installation an update", () => {
		// Those are installed by the package manager, which owns the files.
		expect(isSelfUpdateSupported({ platform: "linux" })).toBe(false);
		expect(isSelfUpdateSupported({ platform: "linux", appImagePath: "   " })).toBe(false);
	});

	it("only updates a macOS bundle that carries a Developer ID signature", () => {
		expect(isSelfUpdateSupported({ platform: "darwin", signedBundle: true })).toBe(true);
		// The unsigned disk images we publish cannot install a signed replacement.
		expect(isSelfUpdateSupported({ platform: "darwin", signedBundle: false })).toBe(false);
		expect(isSelfUpdateSupported({ platform: "darwin" })).toBe(false);
	});

	it("treats an unknown platform as unsupported", () => {
		expect(isSelfUpdateSupported({ platform: "freebsd" as NodeJS.Platform })).toBe(false);
	});
});
