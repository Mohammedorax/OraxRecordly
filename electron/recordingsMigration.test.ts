import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildPathReplacements,
	planLegacyRecordingMigration,
	rewriteProjectPaths,
} from "./recordingsMigration";

const root = path.join("Videos", "OraxRecordly");

describe("planLegacyRecordingMigration", () => {
	it("moves recordings that sit in the root into Cache", () => {
		const plan = planLegacyRecordingMigration({
			rootDir: root,
			entries: [
				{ name: "recording-2026-01-01.mp4", isFile: true },
				{ name: "recording-2026-01-01.mic.wav", isFile: true },
				{ name: "recording-2026-01-01.telemetry.json", isFile: true },
				{ name: "MyExport.mp4", isFile: true },
			],
		});

		expect(plan.moves).toEqual([
			{
				from: path.join(root, "recording-2026-01-01.mp4"),
				to: path.join(root, "Cache", "recording-2026-01-01.mp4"),
			},
			{
				from: path.join(root, "recording-2026-01-01.mic.wav"),
				to: path.join(root, "Cache", "recording-2026-01-01.mic.wav"),
			},
			{
				from: path.join(root, "recording-2026-01-01.telemetry.json"),
				to: path.join(root, "Cache", "recording-2026-01-01.telemetry.json"),
			},
		]);
		// An exported video shares the folder and stays exactly where it is.
		expect(plan.kept).toEqual(["MyExport.mp4"]);
	});

	it("leaves reserved directories, other files and exports alone", () => {
		const plan = planLegacyRecordings([
			{ name: "Cache", isFile: false },
			{ name: "Projects", isFile: false },
			{ name: ".recordly-media", isFile: false },
			{ name: "MyEdited Video.mp4", isFile: false },
			{ name: "notes.txt", isFile: true },
			{ name: "screen.png", isFile: true },
		]);

		expect(plan.moves).toEqual([]);
		expect(plan.kept).toHaveLength(6);
	});

	it("keeps a moved file's name when Cache does not have it yet", () => {
		const plan = planLegacyRecordings([{ name: "recording-a.mp4", isFile: true }]);

		expect(plan.moves[0].to).toBe(path.join(root, "Cache", "recording-a.mp4"));
	});

	it("is case-insensitive when Cache already holds the same name", () => {
		const plan = planLegacyRecordings(
			[{ name: "Recording-A.MP4", isFile: true }],
			["recording-a.mp4"],
		);

		expect(plan.moves[0].to).toBe(path.join(root, "Cache", "Recording-A (1).MP4"));
	});
});

function planLegacyRecordings(
	entries: Array<{ name: string; isFile: boolean }>,
	cacheNames: string[] = [],
) {
	return planLegacyRecordingMigration({
		rootDir: root,
		entries,
		cacheNames: new Set(cacheNames),
	});
}

describe("rewriteProjectPaths", () => {
	const moves = [
		{
			from: path.join(root, "recording-a.mp4"),
			to: path.join(root, "Cache", "recording-a.mp4"),
		},
	];

	it("repoints a project that references a moved recording", () => {
		const content = JSON.stringify({ videoPath: moves[0].from, title: "Take 1" });
		const result = rewriteProjectPaths(content, buildPathReplacements(moves));

		expect(result.changed).toBe(true);
		expect(JSON.parse(result.content).videoPath).toBe(moves[0].to);
		expect(JSON.parse(result.content).title).toBe("Take 1");
	});

	it("repoints URL-encoded and forward-slash references too", () => {
		const replacements = buildPathReplacements(moves);
		// A media URL and a portable path can both end up inside a project file.
		const source = JSON.stringify({
			mediaUrl: `http://127.0.0.1:1/video?path=${encodeURIComponent(moves[0].from)}`,
			portable: moves[0].from.split(path.sep).join("/"),
		});
		const result = rewriteProjectPaths(source, replacements);

		expect(result.changed).toBe(true);
		const parsed = JSON.parse(result.content) as { mediaUrl: string; portable: string };
		expect(parsed.mediaUrl).toBe(
			`http://127.0.0.1:1/video?path=${encodeURIComponent(moves[0].to)}`,
		);
		expect(parsed.portable).toBe(moves[0].to.split(path.sep).join("/"));
	});

	it("leaves a file that is not JSON alone", () => {
		const result = rewriteProjectPaths(moves[0].from, buildPathReplacements(moves));

		expect(result.changed).toBe(false);
		expect(result.content).toBe(moves[0].from);
	});

	it("reports no change for a project that never referenced the file", () => {
		const result = rewriteProjectPaths(
			'{"videoPath":"C:/other/clip.mp4"}',
			buildPathReplacements(moves),
		);

		expect(result.changed).toBe(false);
	});
});
