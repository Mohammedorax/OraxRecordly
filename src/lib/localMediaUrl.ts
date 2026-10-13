/** The port belongs to one app run; persist the file path, never this URL. */
export function isAbsoluteLocalPath(filePath: string): boolean {
	return /^\//.test(filePath) || /^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith("\\\\");
}

function isLoopbackMediaUrl(resource: string): URL | null {
	try {
		const url = new URL(resource);
		if (
			!["http:", "https:"].includes(url.protocol) ||
			!["127.0.0.1", "localhost"].includes(url.hostname) ||
			url.pathname !== "/video"
		) {
			return null;
		}

		return url;
	} catch {
		return null;
	}
}

/**
 * The local file a media-server URL points at, or null when it points elsewhere.
 *
 * Media URLs carry an opaque handle, so the renderer asks the main process for the
 * path behind it (synchronously, because callers resolve URLs while rendering).
 * A `?path=` URL is still understood for anything built before handles existed.
 * In the main process there is no bridge, and callers there resolve a handle
 * directly.
 */
export function getLocalMediaServerPath(resource: string): string | null {
	const url = isLoopbackMediaUrl(resource);
	if (!url) {
		return null;
	}

	const token = url.searchParams.get("i");
	if (token) {
		try {
			const bridge = typeof window === "undefined" ? undefined : window.electronAPI;
			const resolved = bridge?.resolveMediaTokenSync?.(token) ?? null;
			return resolved && isAbsoluteLocalPath(resolved) ? resolved : null;
		} catch {
			// Callers resolve this while rendering, so a failed lookup must not be fatal.
			return null;
		}
	}

	const filePath = url.searchParams.get("path");
	return filePath && isAbsoluteLocalPath(filePath) ? filePath : null;
}
