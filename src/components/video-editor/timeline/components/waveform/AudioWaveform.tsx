import { useTheme } from "@/contexts/ThemeContext";
import { useTimelineContext } from "dnd-timeline";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { AudioPeaksData } from "../../core/timelineTypes";

/**
 * Upper bound on the vertical segments one redraw may stroke. Clips can be tens
 * of thousands of device pixels wide when zoomed in, and one segment per pixel
 * is what makes the redraw expensive.
 */
const MAX_WAVEFORM_SEGMENTS = 512;

/**
 * Columns probed inside a segment that spans more than one pixel, so a narrow
 * peak between probes is still drawn at full height instead of being skipped.
 */
const MAX_PROBES_PER_SEGMENT = 3;

interface AudioWaveformProps {
	peaks: AudioPeaksData;
	segmentStartMs?: number;
	segmentEndMs?: number;
	gain?: number;
	normalize?: boolean;
	className?: string;
}

/**
 * Renders an audio waveform as a canvas that fills its parent container.
 * Automatically syncs with the timeline's visible range so the waveform
 * scrolls and zooms together with the clip items above it.
 */
function AudioWaveformComponent({
	peaks,
	segmentStartMs,
	segmentEndMs,
	gain = 1,
	normalize = false,
	className,
}: AudioWaveformProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const { theme } = useTheme();
	const { range } = useTimelineContext();
	const [resizeKey, setResizeKey] = useState(0);
	const lastDrawAtRef = useRef(0);

	// Bump resizeKey when the canvas element changes size.
	const observerRef = useRef<ResizeObserver | null>(null);
	const setCanvasRef = useCallback((node: HTMLCanvasElement | null) => {
		if (observerRef.current) {
			observerRef.current.disconnect();
			observerRef.current = null;
		}
		(canvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = node;
		if (node) {
			const ro = new ResizeObserver(() => setResizeKey((k) => k + 1));
			ro.observe(node);
			observerRef.current = ro;
		}
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: resizeKey intentionally redraws the canvas after ResizeObserver notifications.
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		let rafId = 0;

		const draw = () => {
			const now = performance.now();
			if (now - lastDrawAtRef.current < 33) {
				rafId = requestAnimationFrame(draw);
				return;
			}
			lastDrawAtRef.current = now;

			const ctx = canvas.getContext("2d");
			if (!ctx) return;

			const rect = canvas.getBoundingClientRect();
			const dpr = window.devicePixelRatio || 1;
			const width = Math.round(rect.width * dpr);
			const height = Math.round(rect.height * dpr);

			if (width === 0 || height === 0) return;

			// Re-assigning width/height resets the bitmap and reallocates it, so only
			// write them when the element's backing-store size actually changed.
			if (canvas.width !== width) canvas.width = width;
			if (canvas.height !== height) canvas.height = height;

			ctx.clearRect(0, 0, width, height);

			const { peaks: peakData, durationMs } = peaks;
			if (durationMs <= 0 || peakData.length === 0) return;

			// Use raw values for smooth zooming/panning (no snapping)
			const visibleStartMs = segmentStartMs ?? range.start;
			const visibleEndMs = segmentEndMs ?? range.end;
			const visibleDurationMs = visibleEndMs - visibleStartMs;

			if (visibleDurationMs <= 0) return;

			const midY = height / 2;
			const amplitudeAtColumn = (px: number): number | null => {
				const t = visibleStartMs + (px / width) * visibleDurationMs;

				// If the timeline time is beyond the actual audio duration, we draw nothing (flat line)
				if (t < 0 || t > durationMs) return null;

				const exactIndex = (t / durationMs) * (peakData.length - 1);
				const leftIndex = Math.floor(exactIndex);
				const rightIndex = Math.min(peakData.length - 1, leftIndex + 1);
				const mix = exactIndex - leftIndex;

				let amplitude = peakData[leftIndex] * (1 - mix) + peakData[rightIndex] * mix;

				if (normalize) amplitude = Math.sqrt(Math.max(0, amplitude));
				return Math.max(0, Math.min(1, amplitude * gain));
			};

			// One segment per pixel below the cap (identical to the previous per-pixel
			// pass); above it, one segment per group of pixels, still probing the outer
			// columns so peaks survive. Segment width grows with the clip width, but the
			// stroke covers the full segment, so the envelope stays solid.
			const segmentWidthPx = Math.max(1, Math.ceil(width / MAX_WAVEFORM_SEGMENTS));
			const segmentCount = Math.ceil(width / segmentWidthPx);
			const probesPerSegment = Math.min(segmentWidthPx, MAX_PROBES_PER_SEGMENT);

			ctx.beginPath();

			for (let segment = 0; segment < segmentCount; segment++) {
				const startPx = segment * segmentWidthPx;
				const endPx = Math.min(width, startPx + segmentWidthPx);
				const probeSpan = endPx - 1 - startPx;

				let amplitude = -1;
				for (let probe = 0; probe < probesPerSegment; probe++) {
					const px =
						probesPerSegment === 1
							? startPx
							: startPx + Math.round((probeSpan * probe) / (probesPerSegment - 1));
					const value = amplitudeAtColumn(px);
					if (value !== null && value > amplitude) amplitude = value;
				}
				if (amplitude < 0) continue;

				const barHeight = amplitude * midY * 0.85;
				const x = startPx + (segmentWidthPx - 1) / 2;

				ctx.moveTo(x, midY - barHeight);
				ctx.lineTo(x, midY + barHeight);
			}

			ctx.strokeStyle = theme === "dark" ? "rgba(255, 255, 255, 0.65)" : "rgba(0, 0, 0, 0.6)";
			ctx.lineWidth = segmentWidthPx > 1 ? Math.max(dpr, segmentWidthPx) : dpr;
			ctx.stroke();
		};
		rafId = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(rafId);
	}, [
		gain,
		normalize,
		peaks,
		range.start,
		range.end,
		resizeKey,
		segmentStartMs,
		segmentEndMs,
		theme,
	]);

	return (
		<canvas
			ref={setCanvasRef}
			className={className ?? "absolute inset-0 w-full h-full pointer-events-none"}
			style={{ display: "block" }}
		/>
	);
}

export default memo(AudioWaveformComponent);
