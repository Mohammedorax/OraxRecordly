/**
 * How many times a dynamic `import()` is attempted before the rejection is
 * allowed to escape to the error boundary.
 */
const MAX_IMPORT_ATTEMPTS = 2;

/**
 * Run a dynamic import, retrying once before rethrowing.
 *
 * A rejected lazy import is the failure mode that used to leave a window
 * permanently blank: React never renders the component and nothing catches the
 * rejection. Most chunk failures are transient — a file still being written
 * while the app starts, a dev-server restart, a momentary read error — so a
 * second attempt usually recovers them silently. A chunk that is genuinely
 * missing fails both attempts and is rethrown, so the nearest error boundary
 * (`AppErrorBoundary` in `src/App.tsx`) renders its fallback instead of an
 * empty window. Reloading the window is the user-facing retry for that case.
 */
export async function loadWithRetry<Module>(loader: () => Promise<Module>): Promise<Module> {
	let lastError: unknown;

	for (let attempt = 1; attempt <= MAX_IMPORT_ATTEMPTS; attempt += 1) {
		try {
			return await loader();
		} catch (error) {
			lastError = error;
			// Context for support: which attempt failed and why. No user data.
			console.error(
				`[recordly] Dynamic import failed (attempt ${attempt}/${MAX_IMPORT_ATTEMPTS})`,
				error,
			);
		}
	}

	throw lastError;
}
