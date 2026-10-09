import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Windows renders a console window for every console-subsystem child process
 * unless `windowsHide` is set. During an export that window stays open for the
 * whole run and shows the ffmpeg command line (including temp paths), so a
 * forgotten flag is a user-visible bug — not a style nit.
 *
 * This guard walks every main-process source file, extracts each process-spawn
 * call site with a paren-aware scanner, and requires the hidden-window options.
 */

const ELECTRON_ROOT = path.resolve(__dirname);
const SCANNED_CALLS = ["spawn", "spawnSync", "execFile", "execFileSync", "execFileAsync"];
const SKIPPED_FILES = new Set(["childProcess.ts"]);

function listSourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...listSourceFiles(fullPath));
			continue;
		}
		if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
		if (SKIPPED_FILES.has(entry.name)) continue;
		files.push(fullPath);
	}
	return files;
}

function skipString(source: string, startIndex: number, quote: string): number {
	let index = startIndex + 1;
	while (index < source.length) {
		const char = source[index];
		if (char === "\\") {
			index += 2;
			continue;
		}
		if (char === quote) return index;
		index += 1;
	}
	return source.length - 1;
}

function skipLineComment(source: string, startIndex: number): number {
	const end = source.indexOf("\n", startIndex);
	return end === -1 ? source.length - 1 : end;
}

function skipBlockComment(source: string, startIndex: number): number {
	const end = source.indexOf("*/", startIndex + 2);
	return end === -1 ? source.length - 1 : end + 1;
}

/** Returns the text between the call's parentheses, ignoring parens in strings. */
function extractCallArguments(source: string, openParenIndex: number): string {
	let depth = 0;
	for (let index = openParenIndex; index < source.length; index += 1) {
		const char = source[index];
		const next = source[index + 1];

		if (char === "/" && next === "/") {
			index = skipLineComment(source, index);
			continue;
		}
		if (char === "/" && next === "*") {
			index = skipBlockComment(source, index);
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			index = skipString(source, index, char);
			continue;
		}
		if (char === "(" || char === "[" || char === "{") {
			depth += 1;
			continue;
		}
		if (char === ")" || char === "]" || char === "}") {
			depth -= 1;
			if (depth === 0) return source.slice(openParenIndex + 1, index);
		}
	}
	return source.slice(openParenIndex + 1);
}

describe("main-process child processes hide their console window", () => {
	it("passes windowsHide to every spawn/execFile call site", () => {
		const violations: string[] = [];

		for (const filePath of listSourceFiles(ELECTRON_ROOT)) {
			const source = fs.readFileSync(filePath, "utf8");
			for (const callName of SCANNED_CALLS) {
				const pattern = new RegExp(`(?<![\\w.$])${callName}\\s*\\(`, "g");
				let match = pattern.exec(source);
				while (match) {
					const openParenIndex = match.index + match[0].length - 1;
					const args = extractCallArguments(source, openParenIndex);
					if (!args.includes("windowsHide") && !args.includes("HIDDEN_WINDOW_OPTIONS")) {
						const line = source.slice(0, match.index).split("\n").length;
						violations.push(
							`${path.relative(ELECTRON_ROOT, filePath)}:${line} ${callName}() is missing windowsHide`,
						);
					}
					match = pattern.exec(source);
				}
			}
		}

		expect(violations).toEqual([]);
	});
});
