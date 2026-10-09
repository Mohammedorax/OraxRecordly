import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAvailableExportPath, sanitizeExportFileName } from "./export/exportDirectory";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-export-dir-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
	);
});

describe("export directory naming", () => {
	it("strips characters that Windows rejects in file names", () => {
		expect(sanitizeExportFileName('demo: "final"?.mp4')).toBe("demo final.mp4");
		expect(sanitizeExportFileName("   ")).toBe("export.mp4");
		expect(sanitizeExportFileName("folder/name.mp4")).toBe("name.mp4");
	});

	it("keeps the requested name when it is free", async () => {
		const dir = await makeTempDir();
		await expect(resolveAvailableExportPath(dir, "export-1.mp4")).resolves.toBe(
			path.join(dir, "export-1.mp4"),
		);
	});

	it("never overwrites an existing export", async () => {
		const dir = await makeTempDir();
		await fs.writeFile(path.join(dir, "export-1.mp4"), "first");
		await expect(resolveAvailableExportPath(dir, "export-1.mp4")).resolves.toBe(
			path.join(dir, "export-1 (2).mp4"),
		);

		await fs.writeFile(path.join(dir, "export-1 (2).mp4"), "second");
		await expect(resolveAvailableExportPath(dir, "export-1.mp4")).resolves.toBe(
			path.join(dir, "export-1 (3).mp4"),
		);
	});
});
