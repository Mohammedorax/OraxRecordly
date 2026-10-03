import type { Locator } from "@playwright/test";

/**
 * The timeline filmstrip paints decoded `ImageBitmap` frames onto `<canvas>`
 * elements (see src/components/video-editor/timeline/components/filmstrip/
 * ClipFilmstrip.tsx: a bitmap cannot be an `<img src>`), so the clip's frames
 * are canvases, not images. Specs used to wait for `[data-variant="clip"] img`,
 * which has matched nothing since that change; use these helpers instead.
 */
export function filmstripFrames(scope: Locator): Locator {
	return scope.locator('[data-testid="clip-filmstrip"] canvas');
}

/** A stable per-frame signature for "these frames are different pictures". */
export function filmstripFrameSignatures(frames: Locator): Promise<string[]> {
	return frames.evaluateAll((canvases) =>
		canvases.map((canvas) => {
			try {
				return (canvas as HTMLCanvasElement).toDataURL().slice(0, 256);
			} catch {
				// A tainted canvas cannot be read; keep it as its own signature.
				return `tainted:${Math.random()}`;
			}
		}),
	);
}
