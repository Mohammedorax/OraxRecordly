/**
 * Guards against version drift between the package manifest and its lockfile.
 *
 * The release pipeline requires the pushed tag to equal `package.json`'s version,
 * and `package-lock.json` records the same version twice (root + "" entry). A
 * stale lockfile version is harmless to `npm ci` but confusing during a release
 * audit, and it already drifted once (manifest 1.4.4 vs lockfile 1.4.0).
 *
 * Runs in the pre-commit hook and in CI, so drift cannot be committed again.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(relativePath) {
	const absolutePath = path.join(rootDir, relativePath);
	try {
		return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
	} catch (error) {
		console.error(`[check-versions] Could not read ${relativePath}: ${String(error)}`);
		process.exit(1);
	}
}

const manifest = readJson("package.json");
const lockfile = readJson("package-lock.json");

const manifestVersion = manifest.version;
const lockfileVersions = [lockfile.version, lockfile.packages?.[""]?.version];

const mismatches = lockfileVersions.filter((version) => version !== manifestVersion);
if (mismatches.length > 0) {
	console.error(
		[
			"[check-versions] Version drift detected:",
			`  package.json                     ${manifestVersion}`,
			`  package-lock.json (root)         ${lockfileVersions[0]}`,
			`  package-lock.json (packages[""]) ${lockfileVersions[1]}`,
			"",
			"Run `npm pkg set version=<new-version>` and update both lockfile version",
			"fields, or re-run `node scripts/check-versions.mjs --fix`.",
		].join("\n"),
	);
	process.exit(1);
}

if (process.argv.includes("--fix")) {
	lockfile.version = manifestVersion;
	if (lockfile.packages?.[""]) {
		lockfile.packages[""].version = manifestVersion;
	}
	fs.writeFileSync(
		path.join(rootDir, "package-lock.json"),
		`${JSON.stringify(lockfile, null, "\t")}\n`,
		"utf8",
	);
	console.log(`[check-versions] Synced package-lock.json to ${manifestVersion}`);
	process.exit(0);
}

console.log(`[check-versions] ${manifestVersion} consistent across manifest and lockfile`);
