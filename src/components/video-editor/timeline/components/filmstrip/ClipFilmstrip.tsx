import { Skeleton } from "@/components/ui/skeleton";
import { useTimelineContext, type Span } from "dnd-timeline";
import { useEffect, useRef, useState } from "react";
import { filmstripSampleTimes } from "../../core/filmstrip";
import { extractFilmstrip } from "./frameCache";

/**
 * A decoded `ImageBitmap` cannot be a CSS background or an `<img src>`, so each
 * filmstrip frame is painted onto its own canvas. `object-cover` keeps the same
 * crop the previous data-URL `<img>` had, and the bitmap itself is already the
 * 16:9 cover crop the decoder produced.
 */
function FilmstripFrame({ bitmap, widthPercent }: { bitmap: ImageBitmap; widthPercent: number }) {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const context = ref.current?.getContext("2d");
		if (!context) return;
		try {
			context.drawImage(bitmap, 0, 0);
		} catch {
			/* The bounded cache may have evicted and closed this bitmap already. */
		}
	}, [bitmap]);
	return (
		<canvas
			ref={ref}
			width={bitmap.width}
			height={bitmap.height}
			className="h-full min-w-0 flex-1 object-cover"
			style={{ width: `${widthPercent}%` }}
		/>
	);
}

export function ClipFilmstrip({
	path,
	span,
	sourceSpan,
}: {
	path: string;
	span: Span;
	sourceSpan: Span;
}) {
	const { range } = useTimelineContext();
	const ref = useRef<HTMLDivElement>(null);
	const [count, setCount] = useState(0);
	const [frames, setFrames] = useState<ImageBitmap[]>([]);
	const [loading, setLoading] = useState(true);
	useEffect(() => {
		const node = ref.current;
		if (!node) return;
		const observer = new ResizeObserver(([entry]) => {
			const { width, height } = entry.contentRect;
			setCount(
				width > 0
					? Math.min(32, Math.max(1, Math.ceil(width / Math.max(60, (height * 16) / 9))))
					: 0,
			);
		});
		observer.observe(node);
		return () => observer.disconnect();
	}, []);
	const start = Math.max(span.start, range.start);
	const end = Math.min(span.end, range.end);
	const [windowRange, setWindowRange] = useState({ start, end, count });
	useEffect(() => {
		const timer = setTimeout(() => setWindowRange({ start, end, count }), 150);
		return () => clearTimeout(timer);
	}, [start, end, count]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: clear stale thumbnails when their source or clip bounds change.
	useEffect(() => {
		setFrames([]);
	}, [path, span.start, span.end, sourceSpan.start, sourceSpan.end]);
	useEffect(() => {
		const controller = new AbortController();
		const times = filmstripSampleTimes(
			{ start: span.start, end: span.end },
			{ start: sourceSpan.start, end: sourceSpan.end },
			windowRange,
			windowRange.count,
		);
		setLoading(times.length > 0);
		if (times.length) {
			void extractFilmstrip(path, times, controller.signal)
				.then((images) => {
					if (!controller.signal.aborted) setFrames(images);
				})
				.catch(() => {
					/* Keep the clip's color when a source cannot be decoded. */
				})
				.finally(() => {
					if (!controller.signal.aborted) setLoading(false);
				});
		}
		return () => controller.abort();
	}, [path, span.start, span.end, sourceSpan.start, sourceSpan.end, windowRange]);
	return (
		<div
			ref={ref}
			data-testid="clip-filmstrip"
			className="pointer-events-none absolute inset-0 flex overflow-hidden rounded-[inherit]"
			aria-hidden="true"
		>
			{loading && frames.length === 0 && <Skeleton className="h-full w-full rounded-none" />}
			{frames.map((frame, index) => (
				<FilmstripFrame key={index} bitmap={frame} widthPercent={100 / frames.length} />
			))}
		</div>
	);
}
