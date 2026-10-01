import { getRenderableVideoUrl } from "@/lib/assetPath";

// One background decoder at a time; never seek the editor's playback element.
let queue: Promise<unknown> = Promise.resolve();
const frames = new Map<string, ImageBitmap>();
const MAX_CACHED_FRAMES = 256;
// Sample times move with every zoom/pan, so cache lookups are bucketed: requests
// landing in the same bucket reuse the frame already decoded for it instead of
// re-seeking and re-decoding. 100 ms is far below the spacing of the 10-32
// thumbnails drawn per clip, so the frame handed back is the same one the user
// would have seen.
const CACHE_BUCKET_MS = 100;
// Frames are decoded straight into this fixed cover crop, matching the 16:9
// boxes the filmstrip lays out.
const FRAME_WIDTH = 160;
const FRAME_HEIGHT = 90;

/** Cache key for a source path plus a sampled source time (ms), quantised to a bucket. */
export function frameCacheKey(path: string, timeMs: number) {
	return `${path}:${Math.round(timeMs / CACHE_BUCKET_MS)}`;
}

/** Cached frame for a key, or undefined when it was never decoded/evicted. */
export function readCachedFrame(key: string): ImageBitmap | undefined {
	return frames.get(key);
}

/**
 * Stores a decoded frame, closing the bitmap it replaces together with anything
 * pushed out of the bounded cache. `ImageBitmap.close()` is the only way to hand
 * the decoded GPU/CPU memory back, so every eviction path must run through here.
 */
export function writeCachedFrame(key: string, frame: ImageBitmap): void {
	const previous = frames.get(key);
	if (previous && previous !== frame) previous.close();
	frames.set(key, frame);
	while (frames.size > MAX_CACHED_FRAMES) {
		const oldest = frames.keys().next().value;
		if (oldest === undefined) break;
		const evicted = frames.get(oldest);
		frames.delete(oldest);
		evicted?.close();
	}
}

/** Drops every cached frame, closing each bitmap. Exposed for cache teardown and tests. */
export function clearFrameCache(): void {
	for (const frame of frames.values()) frame.close();
	frames.clear();
}

function waitForVideo(video: HTMLVideoElement, event: string, signal: AbortSignal) {
	return new Promise<void>((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(timeout);
			video.removeEventListener(event, ready);
			video.removeEventListener("error", failed);
			signal.removeEventListener("abort", failed);
		};
		const ready = () => {
			cleanup();
			resolve();
		};
		const failed = () => {
			cleanup();
			reject(new Error("Frame extraction cancelled or unavailable"));
		};
		const timeout = setTimeout(failed, 8000);
		video.addEventListener(event, ready, { once: true });
		video.addEventListener("error", failed, { once: true });
		signal.addEventListener("abort", failed, { once: true });
		if (signal.aborted) failed();
	});
}

/**
 * Decodes the current video frame off the main thread: `createImageBitmap` takes
 * the cover crop and the downscale to the filmstrip's 16:9 box in one call, so
 * there is no synchronous `drawImage` + `toDataURL` JPEG encode per frame. The
 * resulting bitmap is cached (and eventually closed) instead of a data URL.
 */
async function decodeFrame(video: HTMLVideoElement): Promise<ImageBitmap> {
	const sourceWidth = video.videoWidth;
	const sourceHeight = video.videoHeight;
	const scale = Math.max(FRAME_WIDTH / sourceWidth, FRAME_HEIGHT / sourceHeight);
	const visibleWidth = Math.min(sourceWidth, FRAME_WIDTH / scale);
	const visibleHeight = Math.min(sourceHeight, FRAME_HEIGHT / scale);

	return createImageBitmap(
		video,
		(sourceWidth - visibleWidth) / 2,
		(sourceHeight - visibleHeight) / 2,
		visibleWidth,
		visibleHeight,
		{ resizeWidth: FRAME_WIDTH, resizeHeight: FRAME_HEIGHT, resizeQuality: "medium" },
	);
}

export function extractFilmstrip(
	path: string,
	times: number[],
	signal: AbortSignal,
): Promise<ImageBitmap[]> {
	// The clip already unmounted or scrolled away; don't queue work for it.
	if (signal.aborted) return Promise.resolve([]);
	const job = queue.then(async () => {
		if (signal.aborted) return [];
		const keys = times.map((time) => frameCacheKey(path, time));
		if (keys.every((key) => frames.has(key))) return keys.map((key) => readCachedFrame(key)!);
		const url = await getRenderableVideoUrl(path);
		if (signal.aborted) return [];
		const video = document.createElement("video");
		video.muted = true;
		video.playsInline = true;
		video.preload = "auto";
		video.crossOrigin = "anonymous";
		try {
			const loaded = waitForVideo(video, "loadeddata", signal);
			video.src = url;
			await loaded;
			const result: ImageBitmap[] = [];
			for (let index = 0; index < times.length; index++) {
				if (signal.aborted) return [];
				const cached = readCachedFrame(keys[index]);
				if (cached) {
					result.push(cached);
					continue;
				}
				const time = Math.max(0, Math.min(times[index] / 1000, video.duration - 0.001));
				if (Math.abs(video.currentTime - time) > 0.0001) {
					const sought = waitForVideo(video, "seeked", signal);
					video.currentTime = time;
					await sought;
				}
				// Some non-seekable sources silently reset to zero; don't show misleading copies.
				if (Math.abs(video.currentTime - time) > 0.12)
					throw new Error("Source does not support accurate seeking");
				const frame = await decodeFrame(video);
				if (signal.aborted) {
					frame.close();
					return [];
				}
				writeCachedFrame(keys[index], frame);
				result.push(frame);
			}
			return result;
		} finally {
			video.pause();
			video.removeAttribute("src");
			video.load();
		}
	});
	queue = job.catch(() => undefined);
	return job;
}
