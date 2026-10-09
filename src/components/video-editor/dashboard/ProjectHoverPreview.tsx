import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectPreviewData } from "@/types/projectPreview";
import { normalizeProjectEditor } from "../projectPersistence";
import type { CursorTelemetryPoint } from "../types";
import VideoPlayback, { type VideoPlaybackRef } from "../VideoPlayback";

const ignore = () => undefined;
/**
 * One muted five-second pass through the saved timeline using the editor renderer.
 *
 * The dashboard keeps a single instance of this component mounted and swaps the
 * `data` it receives, so hovering across a grid reuses one Pixi application and
 * one decoder instead of building and tearing down a renderer per card. `active`
 * marks whether the currently retained project is the hovered one: an inactive
 * preview stays mounted (that is the pool) but is paused and hidden.
 */
export function ProjectHoverPreview({
	data,
	active,
	onFinish,
}: {
	data: ProjectPreviewData;
	active: boolean;
	onFinish: () => void;
}) {
	const editor = useMemo(() => normalizeProjectEditor(data.project.editor), [data]);
	const playback = useRef<VideoPlaybackRef>(null);
	const started = useRef(false);
	const [time, setTime] = useState(0);
	const [playing, setPlaying] = useState(false);
	const [duration, setDuration] = useState(0);
	const [telemetry, setTelemetry] = useState<CursorTelemetryPoint[]>([]);
	const sourceKey = data.project.videoPath;
	const clips = useMemo(
		() =>
			editor.clipRegions.length
				? editor.clipRegions
				: duration > 0
					? [
							{
								id: "hover-preview",
								startMs: 0,
								endMs: duration * 1000,
								sourceStartMs: 0,
								speed: 1,
							},
						]
					: [],
		[editor.clipRegions, duration],
	);
	useEffect(() => {
		let mounted = true;
		void window.electronAPI
			.getCursorTelemetry(sourceKey)
			.then((result) => {
				if (mounted && result.success) setTelemetry(result.samples);
			})
			.catch(ignore);
		return () => {
			mounted = false;
		};
	}, [sourceKey]);
	const updateTime = useCallback(
		(seconds: number) => {
			if (seconds >= 5) {
				playback.current?.pause();
				onFinish();
			} else setTime(seconds);
		},
		[onFinish],
	);
	const updatePlaying = useCallback(
		(value: boolean) => {
			setPlaying(value);
			if (value) started.current = true;
			else if (started.current) onFinish();
		},
		[onFinish],
	);
	/**
	 * Reusing the host means per-hover playback state has to be reset by hand:
	 * without this the next hover would resume wherever the previous one stopped.
	 * The explicit seek also covers a re-hover of the same card, where the media
	 * source does not change and `autoPlay` therefore has nothing to restart.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new source must restart the retained host's pass even though the value is only consumed through child props.
	useEffect(() => {
		started.current = false;
		setTime(0);
		setPlaying(false);
		if (!active) {
			playback.current?.pause();
			return;
		}
		playback.current?.seekTimeline(0);
		void playback.current?.play().catch(ignore);
	}, [active, sourceKey]);
	useEffect(() => {
		if (!active) return;
		// A stalled decoder or unavailable GPU must leave the static thumbnail usable.
		const timeout = window.setTimeout(onFinish, 15000);
		const stopWhenHidden = () => {
			if (document.hidden) onFinish();
		};
		document.addEventListener("visibilitychange", stopWhenHidden);
		return () => {
			clearTimeout(timeout);
			document.removeEventListener("visibilitychange", stopWhenHidden);
			playback.current?.pause();
		};
	}, [active, onFinish]);
	return (
		<div
			// The host element is pooled, so the marker only identifies a preview
			// while one is actually showing; between hovers this node stays mounted
			// (holding the renderer) but is not a `[data-project-hover-preview]`.
			{...(active ? { "data-project-hover-preview": true } : {})}
			className={`pointer-events-none absolute inset-0 overflow-hidden rounded-xl ${active && playing ? "opacity-100" : "opacity-0"}`}
			aria-hidden="true"
		>
			<VideoPlayback
				{...editor}
				autoPlay={active}
				aspectRatio="4:3"
				ref={playback}
				videoPath={data.videoUrl}
				clipRegions={clips}
				showShadow={editor.shadowIntensity > 0}
				currentTime={time}
				isPlaying={playing}
				volume={0}
				cursorTelemetry={telemetry}
				selectedZoomId={null}
				onSelectZoom={ignore}
				onZoomFocusChange={ignore}
				onDurationChange={setDuration}
				onTimeUpdate={updateTime}
				onPlayStateChange={updatePlaying}
				onError={onFinish}
			/>
		</div>
	);
}
