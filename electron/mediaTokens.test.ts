import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
	getMediaTokenFromUrl,
	registerMediaPath,
	resetMediaTokens,
	resolveMediaToken,
	resolveMediaUrlPath,
} from "./mediaTokens";

const file = path.join("Videos", "OraxRecordly", "Cache", "recording-1.mp4");

beforeEach(() => {
	resetMediaTokens();
});

describe("registerMediaPath", () => {
	it("returns a handle that carries no part of the path", () => {
		const token = registerMediaPath(file);

		expect(token).not.toContain("Videos");
		expect(token).not.toContain("recording");
		expect(token).not.toContain(path.sep);
		expect(token.length).toBeGreaterThanOrEqual(24);
	});

	it("is stable for the same file and different for another", () => {
		expect(registerMediaPath(file)).toBe(registerMediaPath(file));
		expect(registerMediaPath(file)).not.toBe(registerMediaPath(`${file}.other`));
	});

	it("resolves back to the file it was registered for", () => {
		const token = registerMediaPath(file);

		expect(resolveMediaToken(token)).toBe(file);
		expect(resolveMediaToken("nonsense")).toBeNull();
		expect(resolveMediaToken("")).toBeNull();
	});

	it("leaves an unknown handle unresolvable after a reset", () => {
		const token = registerMediaPath(file);
		resetMediaTokens();

		expect(resolveMediaToken(token)).toBeNull();
	});
});

describe("media URL handles", () => {
	it("reads the handle out of a media URL", () => {
		const token = registerMediaPath(file);
		const url = `http://127.0.0.1:5000/video?i=${token}`;

		expect(getMediaTokenFromUrl(url)).toBe(token);
		expect(resolveMediaUrlPath(url)).toBe(file);
	});

	it("ignores URLs that are not the media endpoint", () => {
		expect(getMediaTokenFromUrl("http://127.0.0.1:5000/other?i=abc")).toBeNull();
		expect(getMediaTokenFromUrl("not a url")).toBeNull();
		expect(resolveMediaUrlPath("http://127.0.0.1:5000/video?i=unknown")).toBeNull();
	});

	it("still understands a legacy path URL", () => {
		// URLs built before handles existed must keep working.
		expect(
			getMediaTokenFromUrl(`http://127.0.0.1:5/video?path=${encodeURIComponent(file)}`),
		).toBeNull();
		expect(
			resolveMediaUrlPath(`http://127.0.0.1:5/video?path=${encodeURIComponent(file)}`),
		).toBeNull();
	});
});
