import type { ComponentProps, Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useMemo, useRef } from "react";
import type { KeycastKeystroke, KeycastSettings } from "@/lib/keycast/keycastModel";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import type { useVideoEditorAudio } from "../audio/useVideoEditorAudio";
import { createTimeUpdateThrottle } from "../preview/timeUpdateThrottle";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useTimelineState } from "../state/useTimelineState";
import type { CursorTelemetryPoint, ZoomRegion } from "../types";
import VideoPlayback, { type VideoPlaybackRef } from "../VideoPlayback";

/**
 * How often the playhead position reaches React while playing.
 *
 * The preview draws every frame regardless; this only bounds how often editor
 * state changes, which used to be once per animation frame and re-rendered the
 * whole editor with it. 30 Hz is smooth for a playhead and halves the work.
 */
const PLAYHEAD_UPDATE_INTERVAL_MS = 33;

type PlaybackProps = ComponentProps<typeof VideoPlayback>;
type Handlers = Pick<
	PlaybackProps,
	| "onSelectZoom"
	| "onZoomFocusChange"
	| "onEditAutoCaption"
	| "onSelectAnnotation"
	| "onAnnotationPositionChange"
	| "onAnnotationSizeChange"
>;

type Props = {
	videoPath: string | null;
	previewVersion: number;
	aspectRatio: AspectRatio;
	playbackRef: RefObject<VideoPlaybackRef | null>;
	currentTime: number;
	isPlaying: boolean;
	previewVolume: number;
	suspendRendering: boolean;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	audio: ReturnType<typeof useVideoEditorAudio>;
	effectiveZoomRegions: ZoomRegion[];
	effectiveCursorTelemetry: CursorTelemetryPoint[];
	effectiveKeycastEvents: KeycastKeystroke[];
	keycastSettings: KeycastSettings;
	effectiveShowCursor: boolean;
	setDuration: Dispatch<SetStateAction<number>>;
	setIsPreviewReady: Dispatch<SetStateAction<boolean>>;
	setCurrentTime: Dispatch<SetStateAction<number>>;
	setIsPlaying: Dispatch<SetStateAction<boolean>>;
	setError: (message: string | null) => void;
	handlers: Handlers;
};

export function EditorVideoPreview({
	videoPath,
	previewVersion,
	aspectRatio,
	playbackRef,
	currentTime,
	isPlaying,
	previewVolume,
	suspendRendering,
	appearance,
	timeline,
	audio,
	effectiveZoomRegions,
	effectiveCursorTelemetry,
	effectiveKeycastEvents,
	keycastSettings,
	effectiveShowCursor,
	setDuration,
	setIsPreviewReady,
	setCurrentTime,
	setIsPlaying,
	setError,
	handlers,
}: Props) {
	const setCurrentTimeRef = useRef(setCurrentTime);
	setCurrentTimeRef.current = setCurrentTime;

	// One throttle for the life of the preview; the setter is read through a ref so
	// a re-render never rebuilds it.
	const throttle = useMemo(
		() =>
			createTimeUpdateThrottle({
				minIntervalMs: PLAYHEAD_UPDATE_INTERVAL_MS,
				onUpdate: (time) => setCurrentTimeRef.current(time),
			}),
		[],
	);

	// A pause, a seek or an unmount must land on the exact time, not on the last
	// throttled sample.
	useEffect(() => {
		if (!isPlaying) {
			throttle.flush();
		}
	}, [isPlaying, throttle]);

	useEffect(() => () => throttle.dispose(), [throttle]);

	return (
		<VideoPlayback
			clipRegions={timeline.clipRegions}
			key={`${videoPath || "no-video"}:${previewVersion}:inline`}
			aspectRatio={aspectRatio}
			ref={playbackRef}
			videoPath={videoPath || ""}
			onDurationChange={setDuration}
			onPreviewReadyChange={setIsPreviewReady}
			onTimeUpdate={throttle.push}
			currentTime={currentTime}
			onPlayStateChange={setIsPlaying}
			onError={setError}
			wallpaper={appearance.wallpaper}
			zoomRegions={effectiveZoomRegions}
			selectedZoomId={timeline.selectedZoomId}
			isPlaying={isPlaying}
			showShadow={appearance.shadowIntensity > 0}
			shadowIntensity={appearance.shadowIntensity}
			backgroundBlur={appearance.backgroundBlur}
			connectZooms={appearance.connectZooms}
			zoomInDurationMs={appearance.zoomInDurationMs}
			zoomInOverlapMs={appearance.zoomInOverlapMs}
			zoomOutDurationMs={appearance.zoomOutDurationMs}
			connectedZoomGapMs={appearance.connectedZoomGapMs}
			connectedZoomDurationMs={appearance.connectedZoomDurationMs}
			zoomInEasing={appearance.zoomInEasing}
			zoomOutEasing={appearance.zoomOutEasing}
			connectedZoomEasing={appearance.connectedZoomEasing}
			borderRadius={appearance.borderRadius}
			padding={appearance.padding}
			cropRegion={appearance.cropRegion}
			annotationRegions={timeline.annotationRegions}
			autoCaptions={timeline.autoCaptions}
			autoCaptionSettings={timeline.autoCaptionSettings}
			selectedAnnotationId={timeline.selectedAnnotationId}
			cursorTelemetry={effectiveCursorTelemetry}
			keycastEvents={effectiveKeycastEvents}
			keycastSettings={keycastSettings}
			clipTransitionSettings={appearance.clipTransitionSettings}
			showCursor={effectiveShowCursor}
			cursorStyle={appearance.cursorStyle}
			cursorSize={appearance.cursorSize}
			cursorSmoothing={appearance.cursorSmoothing}
			cursorSpringStiffnessMultiplier={appearance.cursorSpringStiffnessMultiplier}
			cursorSpringDampingMultiplier={appearance.cursorSpringDampingMultiplier}
			cursorSpringMassMultiplier={appearance.cursorSpringMassMultiplier}
			cameraSpringStiffnessMultiplier={appearance.cameraSpringStiffnessMultiplier}
			cameraSpringDampingMultiplier={appearance.cameraSpringDampingMultiplier}
			cameraSpringMassMultiplier={appearance.cameraSpringMassMultiplier}
			zoomSmoothness={appearance.zoomSmoothness}
			zoomClassicMode={appearance.zoomClassicMode}
			zoomMotionBlur={appearance.zoomMotionBlur}
			zoomMotionBlurTuning={appearance.zoomMotionBlurTuning}
			cursorMotionBlur={appearance.cursorMotionBlur}
			cursorClickEffect={appearance.cursorClickEffect}
			cursorClickEffectColor={appearance.cursorClickEffectColor}
			cursorClickEffectScale={appearance.cursorClickEffectScale}
			cursorClickEffectOpacity={appearance.cursorClickEffectOpacity}
			cursorClickEffectDurationMs={appearance.cursorClickEffectDurationMs}
			cursorClickBounce={appearance.cursorClickBounce}
			cursorClickBounceDuration={appearance.cursorClickBounceDuration}
			cursorSway={appearance.cursorSway}
			volume={
				audio.shouldMutePreviewVideo || audio.isCurrentClipMuted
					? 0
					: Math.max(0, Math.min(1, previewVolume * audio.embeddedSourcePreviewGain))
			}
			suspendRendering={suspendRendering}
			{...handlers}
		/>
	);
}
