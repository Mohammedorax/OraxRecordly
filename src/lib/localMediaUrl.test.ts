import { afterEach, describe, expect, it, vi } from "vitest";
import { getLocalMediaServerPath, isAbsoluteLocalPath } from "./localMediaUrl";

const originalWindow = (globalThis as { window?: unknown }).window;

afterEach(() => {
	if (originalWindow === undefined) {
		delete (globalThis as { window?: unknown }).window;
	} else {
		(globalThis as { window?: unknown }).window = originalWindow;
	}
});

function withBridge(resolver: (token: string) => string | null) {
	(globalThis as { window?: unknown }).window = {
		electronAPI: { resolveMediaTokenSync: resolver },
	};
}

describe("getLocalMediaServerPath", () => {
	it("asks the bridge for the file behind a handle", () => {
		withBridge((token) => (token === "abc" ? "C:\\Videos\\Cache\\clip.mp4" : null));

		expect(getLocalMediaServerPath("http://127.0.0.1:5000/video?i=abc")).toBe(
			"C:\\Videos\\Cache\\clip.mp4",
		);
	});

	it("returns nothing when the handle is unknown or the bridge is absent", () => {
		withBridge(() => null);
		expect(getLocalMediaServerPath("http://127.0.0.1:5000/video?i=abc")).toBeNull();

		(globalThis as { window?: unknown }).window = {};
		expect(getLocalMediaServerPath("http://127.0.0.1:5000/video?i=abc")).toBeNull();
	});

	it("still reads a legacy path URL", () => {
		(globalThis as { window?: unknown }).window = {};

		expect(getLocalMediaServerPath("http://127.0.0.1:5000/video?path=%2Ftmp%2Fclip.mp4")).toBe(
			"/tmp/clip.mp4",
		);
		expect(getLocalMediaServerPath("http://127.0.0.1:5000/video?path=C%3A%5Cclip.mp4")).toBe(
			"C:\\clip.mp4",
		);
	});

	it("ignores anything that is not a loopback media URL", () => {
		(globalThis as { window?: unknown }).window = {};

		expect(getLocalMediaServerPath("https://example.com/video?path=/tmp/a.mp4")).toBeNull();
		expect(getLocalMediaServerPath("http://127.0.0.1:5000/other?path=/tmp/a.mp4")).toBeNull();
		expect(getLocalMediaServerPath("http://127.0.0.1:5000/video?path=relative.mp4")).toBeNull();
		expect(getLocalMediaServerPath("not a url")).toBeNull();
	});

	it("accepts localhost as well as the loopback address", () => {
		withBridge(() => "/tmp/clip.mp4");

		expect(getLocalMediaServerPath("http://localhost:5000/video?i=abc")).toBe("/tmp/clip.mp4");
	});
});

describe("isAbsoluteLocalPath", () => {
	it("recognises the shapes a local file path can take", () => {
		expect(isAbsoluteLocalPath("/tmp/clip.mp4")).toBe(true);
		expect(isAbsoluteLocalPath("C:\\Videos\\clip.mp4")).toBe(true);
		expect(isAbsoluteLocalPath("C:/Videos/clip.mp4")).toBe(true);
		expect(isAbsoluteLocalPath("\\\\server\\share\\clip.mp4")).toBe(true);
		expect(isAbsoluteLocalPath("clip.mp4")).toBe(false);
		expect(isAbsoluteLocalPath("")).toBe(false);
	});
});

describe("resolveMediaTokenSync bridge misuse", () => {
	it("never throws when the bridge fails", () => {
		(globalThis as { window?: unknown }).window = {
			electronAPI: {
				resolveMediaTokenSync: vi.fn(() => {
					throw new Error("no bridge");
				}),
			},
		};

		expect(getLocalMediaServerPath("http://127.0.0.1:1/video?i=abc")).toBeNull();
	});
});
