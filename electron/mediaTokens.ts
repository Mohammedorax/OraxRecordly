import { createHash, randomBytes } from "node:crypto";
import path from "node:path";

/**
 * Opaque handles for local media served over the loopback media server.
 *
 * The server URL used to carry the file's absolute path in a query parameter,
 * which put the user's folder layout into every `src` attribute, tooltip and log
 * line that ever saw the URL. A handle is a hash of the path under a random
 * per-run salt: stable for the same file within a run, useless outside it, and
 * impossible to turn back into a path by guessing.
 *
 * The renderer still needs the path behind a handle (audio peaks, captions and
 * project saving all work on the file), so the mapping stays available in memory
 * for the lifetime of the process and is reachable through a synchronous lookup.
 */

const SALT = randomBytes(16);
const tokenToPath = new Map<string, string>();
const pathToToken = new Map<string, string>();

function normalizeKey(filePath: string): string {
	const resolved = path.resolve(filePath);
	// Windows paths are case-insensitive, and the same file reaches us under
	// different capitalisation depending on where it came from.
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** The handle for a local file, registering it on first use. */
export function registerMediaPath(filePath: string): string {
	const key = normalizeKey(filePath);
	const existing = pathToToken.get(key);
	if (existing) {
		return existing;
	}

	const token = createHash("sha256")
		.update(SALT)
		.update("\0")
		.update(key)
		.digest("base64url")
		.slice(0, 32);

	tokenToPath.set(token, filePath);
	pathToToken.set(key, token);
	return token;
}

/** The file behind a handle, or null when the handle is unknown or stale. */
export function resolveMediaToken(token: string): string | null {
	if (!token) {
		return null;
	}

	return tokenToPath.get(token) ?? null;
}

/** Extracts the handle from a media-server URL, without needing the file path. */
export function getMediaTokenFromUrl(resource: string): string | null {
	try {
		const url = new URL(resource);
		if (url.pathname !== "/video") {
			return null;
		}

		const token = url.searchParams.get("i");
		return token && token.length > 0 ? token : null;
	} catch {
		return null;
	}
}

/** Resolves a media-server URL that carries a handle. */
export function resolveMediaUrlPath(resource: string): string | null {
	const token = getMediaTokenFromUrl(resource);
	return token ? resolveMediaToken(token) : null;
}

/** Test seam: forgets every mapping (a new run starts empty anyway). */
export function resetMediaTokens(): void {
	tokenToPath.clear();
	pathToToken.clear();
}
