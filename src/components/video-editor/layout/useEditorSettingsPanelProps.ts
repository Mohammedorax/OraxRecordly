import { type ComponentProps, type Dispatch, type SetStateAction, useMemo } from "react";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import { useClipAudioReset } from "../audio/useClipAudioReset";
import type { useAutoCaptionController } from "../captions/useAutoCaptionController";
import type { useAnnotationRegionCommands } from "../hooks/useAnnotationRegionCommands";
import type { useAudioRegionCommands } from "../hooks/useAudioRegionCommands";
import type { useCaptionCommands } from "../hooks/useCaptionCommands";
import type { useClipRegionCommands } from "../hooks/useClipRegionCommands";
import type { useZoomRegionCommands } from "../hooks/useZoomRegionCommands";
import { SettingsPanel } from "../SettingsPanel";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useTimelineState } from "../state/useTimelineState";
import { type EditorEffectSection, mapTimelineTimeToSourceTime } from "../types";

type Input = {
	activeEffectSection: EditorEffectSection;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	zoomCommands: ReturnType<typeof useZoomRegionCommands>;
	clipCommands: ReturnType<typeof useClipRegionCommands>;
	audioCommands: ReturnType<typeof useAudioRegionCommands>;
	captionCommands: ReturnType<typeof useCaptionCommands>;
	annotationCommands: ReturnType<typeof useAnnotationRegionCommands>;
	autoCaptionController: ReturnType<typeof useAutoCaptionController>;
	effectiveShowCursor: boolean;
	handleShowCursorChange: (show: boolean) => void;
	currentTime: number;
	aspectRatio: AspectRatio;
	setAspectRatio: Dispatch<SetStateAction<AspectRatio>>;
	whisperExecutablePath: string | null;
	whisperModelPath: string | null;
	whisperModelDownloadStatus: "idle" | "downloading" | "downloaded" | "error";
	whisperModelDownloadProgress: number;
	isGeneratingCaptions: boolean;
	sessionNativeCaptureUnavailable: boolean;
	setNativeCaptureUnavailableModalOpen: Dispatch<SetStateAction<boolean>>;
};

export function useEditorSettingsPanelProps(input: Input): ComponentProps<typeof SettingsPanel> {
	const {
		activeEffectSection,
		appearance,
		timeline,
		zoomCommands,
		clipCommands,
		audioCommands,
		captionCommands,
		annotationCommands,
		autoCaptionController,
		effectiveShowCursor,
		handleShowCursorChange,
		currentTime,
		aspectRatio,
		setAspectRatio,
		whisperExecutablePath,
		whisperModelPath,
		whisperModelDownloadStatus,
		whisperModelDownloadProgress,
		isGeneratingCaptions,
		sessionNativeCaptureUnavailable,
		setNativeCaptureUnavailableModalOpen,
	} = input;
	const selectedZoom = timeline.zoomRegions.find(
		(region) => region.id === timeline.selectedZoomId,
	);
	const selectedClip = timeline.clipRegions.find(
		(region) => region.id === timeline.selectedClipId,
	);
	const selectedAudio = timeline.audioRegions.find(
		(region) => region.id === timeline.selectedAudioId,
	);

	const clipAudioReset = useClipAudioReset(timeline);

	// `captionCurrentTimeMs` is only read by the caption editor section. Deriving it from
	// the playhead unconditionally would put `currentTime` in the memo dependency list
	// below and rebuild these props (re-rendering the whole settings panel) on every
	// playback frame; switching sections re-runs this line with the current playhead, so
	// the section that actually consumes it always sees a live value.
	const captionCurrentTimeMs =
		activeEffectSection === "caption"
			? mapTimelineTimeToSourceTime(currentTime * 1000, timeline.clipRegions)
			: 0;

	// A fresh object here is what makes <SettingsPanel /> and the
	// DashboardSettingsContext value change identity on every render, so the
	// object has to keep a stable identity until one of the values it carries
	// actually changes. `appearance`, `timeline` and the command hooks all return
	// new object literals on every render, so every field this object reads from
	// them is listed individually below.
	//
	// `clipAudioReset` is the one value that cannot be listed as-is: it returns a
	// new object (and a new `onResetClipAudio` closure) on every render. That
	// closure reads exactly the four `timeline` values listed first below, and
	// `hasClipAudioOverrides` is derived from the same values, so a render in
	// which the clip-audio props could behave differently is always a render in
	// which this memo recomputes.
	//
	// biome-ignore lint/correctness/useExhaustiveDependencies: every value this memo reads is covered below. The rule cannot see through `...clipAudioReset` (line 90), whose closure reads only the four `timeline` clip-audio values listed first in the dependency array, nor that `selectedZoom`/`selectedClip`/`selectedAudio` are `.find` lookups derived from `timeline.zoomRegions`/`clipRegions`/`audioRegions`, which are listed. The rule's "unnecessary" members (`sourceAudioTrackSettingsByClip`, `defaultSourceAudioTrackSettings`, `setSourceAudioTrackSettingsByClip`, `zoomRegions`, `audioRegions`) are exactly those inputs. Adding the fresh-per-render `clipAudioReset` object would break the stable identity this memo exists to provide.
	return useMemo<ComponentProps<typeof SettingsPanel>>(
		() => ({
			...clipAudioReset,
			panelMode: "editor",
			activeEffectSection,
			selected: appearance.wallpaper,
			onWallpaperChange: appearance.setWallpaper,
			selectedZoomDepth: selectedZoom?.depth ?? null,
			onZoomDepthChange: (depth) =>
				timeline.selectedZoomId && zoomCommands.handleZoomDepthChange(depth),
			selectedZoomId: timeline.selectedZoomId,
			selectedZoomMode: selectedZoom?.mode ?? (timeline.selectedZoomId ? "auto" : null),
			onZoomModeChange: (mode) =>
				timeline.selectedZoomId && zoomCommands.handleZoomModeChange(mode),
			onZoomDelete: zoomCommands.handleZoomDelete,
			selectedClipId: timeline.selectedClipId,
			selectedClipSpeed: selectedClip?.speed ?? (timeline.selectedClipId ? 1 : null),
			selectedClipMuted: selectedClip?.muted ?? (timeline.selectedClipId ? false : null),
			onClipSpeedChange: clipCommands.handleClipSpeedChange,
			onClipMutedChange: clipCommands.handleClipMutedChange,
			onClipDelete: clipCommands.handleClipDelete,
			selectedAudioId: timeline.selectedAudioId,
			selectedAudioVolume: selectedAudio?.volume ?? null,
			selectedAudioNormalize:
				selectedAudio?.normalize ?? (timeline.selectedAudioId ? false : null),
			onAudioVolumeChange: audioCommands.handleAudioVolumeChange,
			onAudioNormalizeChange: audioCommands.handleAudioNormalizeChange,
			onAudioDelete: audioCommands.handleAudioDelete,
			shadowIntensity: appearance.shadowIntensity,
			onShadowChange: appearance.setShadowIntensity,
			backgroundBlur: appearance.backgroundBlur,
			onBackgroundBlurChange: appearance.setBackgroundBlur,
			autoApplyFreshRecordingAutoZooms: appearance.autoApplyFreshRecordingAutoZooms,
			onAutoApplyFreshRecordingAutoZoomsChange:
				appearance.setAutoApplyFreshRecordingAutoZooms,
			connectZooms: appearance.connectZooms,
			onConnectZoomsChange: appearance.setConnectZooms,
			zoomInDurationMs: appearance.zoomInDurationMs,
			onZoomInDurationMsChange: appearance.setZoomInDurationMs,
			zoomInOverlapMs: appearance.zoomInOverlapMs,
			onZoomInOverlapMsChange: appearance.setZoomInOverlapMs,
			zoomOutDurationMs: appearance.zoomOutDurationMs,
			onZoomOutDurationMsChange: appearance.setZoomOutDurationMs,
			connectedZoomGapMs: appearance.connectedZoomGapMs,
			onConnectedZoomGapMsChange: appearance.setConnectedZoomGapMs,
			connectedZoomDurationMs: appearance.connectedZoomDurationMs,
			onConnectedZoomDurationMsChange: appearance.setConnectedZoomDurationMs,
			zoomInEasing: appearance.zoomInEasing,
			onZoomInEasingChange: appearance.setZoomInEasing,
			zoomOutEasing: appearance.zoomOutEasing,
			onZoomOutEasingChange: appearance.setZoomOutEasing,
			connectedZoomEasing: appearance.connectedZoomEasing,
			onConnectedZoomEasingChange: appearance.setConnectedZoomEasing,
			showCursor: effectiveShowCursor,
			onShowCursorChange: handleShowCursorChange,
			loopCursor: appearance.loopCursor,
			onLoopCursorChange: appearance.setLoopCursor,
			cursorStyle: appearance.cursorStyle,
			onCursorStyleChange: appearance.setCursorStyle,
			cursorSize: appearance.cursorSize,
			onCursorSizeChange: appearance.setCursorSize,
			cursorSmoothing: appearance.cursorSmoothing,
			onCursorSmoothingChange: appearance.setCursorSmoothing,
			cursorSpringStiffnessMultiplier: appearance.cursorSpringStiffnessMultiplier,
			onCursorSpringStiffnessMultiplierChange: appearance.setCursorSpringStiffnessMultiplier,
			cursorSpringDampingMultiplier: appearance.cursorSpringDampingMultiplier,
			onCursorSpringDampingMultiplierChange: appearance.setCursorSpringDampingMultiplier,
			cursorSpringMassMultiplier: appearance.cursorSpringMassMultiplier,
			onCursorSpringMassMultiplierChange: appearance.setCursorSpringMassMultiplier,
			cameraSpringStiffnessMultiplier: appearance.cameraSpringStiffnessMultiplier,
			onCameraSpringStiffnessMultiplierChange: appearance.setCameraSpringStiffnessMultiplier,
			cameraSpringDampingMultiplier: appearance.cameraSpringDampingMultiplier,
			onCameraSpringDampingMultiplierChange: appearance.setCameraSpringDampingMultiplier,
			cameraSpringMassMultiplier: appearance.cameraSpringMassMultiplier,
			onCameraSpringMassMultiplierChange: appearance.setCameraSpringMassMultiplier,
			zoomClassicMode: appearance.zoomClassicMode,
			onZoomClassicModeChange: appearance.setZoomClassicMode,
			cursorClickEffect: appearance.cursorClickEffect,
			cursorClickEffectColor: appearance.cursorClickEffectColor,
			onCursorClickEffectChange: appearance.setCursorClickEffect,
			onCursorClickEffectColorChange: appearance.setCursorClickEffectColor,
			cursorClickEffectScale: appearance.cursorClickEffectScale,
			onCursorClickEffectScaleChange: appearance.setCursorClickEffectScale,
			cursorClickEffectOpacity: appearance.cursorClickEffectOpacity,
			onCursorClickEffectOpacityChange: appearance.setCursorClickEffectOpacity,
			cursorClickEffectDurationMs: appearance.cursorClickEffectDurationMs,
			onCursorClickEffectDurationMsChange: appearance.setCursorClickEffectDurationMs,
			cursorClickBounce: appearance.cursorClickBounce,
			onCursorClickBounceChange: appearance.setCursorClickBounce,
			cursorClickBounceDuration: appearance.cursorClickBounceDuration,
			onCursorClickBounceDurationChange: appearance.setCursorClickBounceDuration,
			cursorSway: appearance.cursorSway,
			onCursorSwayChange: appearance.setCursorSway,
			keycastSettings: appearance.keycastSettings,
			onKeycastSettingsChange: appearance.setKeycastSettings,
			borderRadius: appearance.borderRadius,
			onBorderRadiusChange: appearance.setBorderRadius,
			padding: appearance.padding,
			onPaddingChange: appearance.setPadding,
			cropRegion: appearance.cropRegion,
			onCropChange: appearance.setCropRegion,
			aspectRatio,
			onAspectRatioChange: setAspectRatio,
			selectedAnnotationId: timeline.selectedAnnotationId,
			annotationRegions: timeline.annotationRegions,
			autoCaptions: timeline.autoCaptions,
			autoCaptionSettings: timeline.autoCaptionSettings,
			whisperExecutablePath,
			whisperModelPath,
			whisperModelDownloadStatus,
			whisperModelDownloadProgress,
			isGeneratingCaptions,
			onAutoCaptionSettingsChange: timeline.setAutoCaptionSettings,
			onPickWhisperExecutable: autoCaptionController.handlePickWhisperExecutable,
			onPickWhisperModel: autoCaptionController.handlePickWhisperModel,
			onGenerateAutoCaptions: autoCaptionController.handleGenerateAutoCaptions,
			onClearAutoCaptions: captionCommands.handleClearAutoCaptions,
			captionCurrentTimeMs,
			selectedCaptionId: timeline.selectedCaptionId,
			onBeginCaptionEdit: captionCommands.handleBeginCaptionEdit,
			onCaptionTextEdit: captionCommands.handleCaptionTextEdit,
			onCaptionRetime: captionCommands.handleCaptionRetime,
			onCaptionSplit: captionCommands.handleCaptionSplit,
			onCaptionMerge: captionCommands.handleCaptionMerge,
			onCaptionDelete: captionCommands.handleCaptionDelete,
			onDownloadWhisperSmallModel: autoCaptionController.handleDownloadWhisperSmallModel,
			onDeleteWhisperSmallModel: autoCaptionController.handleDeleteWhisperSmallModel,
			nativeCaptureUnavailableSession: sessionNativeCaptureUnavailable,
			onOpenNativeCaptureUnavailableModal: () => setNativeCaptureUnavailableModalOpen(true),
			onAnnotationContentChange: annotationCommands.handleAnnotationContentChange,
			onAnnotationTypeChange: annotationCommands.handleAnnotationTypeChange,
			onAnnotationStyleChange: annotationCommands.handleAnnotationStyleChange,
			onAnnotationFigureDataChange: annotationCommands.handleAnnotationFigureDataChange,
			onAnnotationBlurIntensityChange: annotationCommands.handleAnnotationBlurIntensityChange,
			onAnnotationBlurColorChange: annotationCommands.handleAnnotationBlurColorChange,
			onAnnotationDelete: annotationCommands.handleAnnotationDelete,
		}),
		[
			// `clipAudioReset` inputs (see the note above).
			timeline.selectedClipId,
			timeline.sourceAudioTrackSettingsByClip,
			timeline.defaultSourceAudioTrackSettings,
			timeline.setSourceAudioTrackSettingsByClip,
			// `selectedAudio` is derived from the audio regions; both of the fields
			// read from it are listed so the memo cannot serve a stale value.
			selectedAudio?.volume,
			selectedAudio?.normalize,
			activeEffectSection,
			effectiveShowCursor,
			handleShowCursorChange,
			captionCurrentTimeMs,
			aspectRatio,
			setAspectRatio,
			whisperExecutablePath,
			whisperModelPath,
			whisperModelDownloadStatus,
			whisperModelDownloadProgress,
			isGeneratingCaptions,
			sessionNativeCaptureUnavailable,
			setNativeCaptureUnavailableModalOpen,
			// `appearance` fields (the hook returns a new object literal each render).
			appearance.wallpaper,
			appearance.setWallpaper,
			appearance.shadowIntensity,
			appearance.setShadowIntensity,
			appearance.backgroundBlur,
			appearance.setBackgroundBlur,
			appearance.autoApplyFreshRecordingAutoZooms,
			appearance.setAutoApplyFreshRecordingAutoZooms,
			appearance.connectZooms,
			appearance.setConnectZooms,
			appearance.zoomInDurationMs,
			appearance.setZoomInDurationMs,
			appearance.zoomInOverlapMs,
			appearance.setZoomInOverlapMs,
			appearance.zoomOutDurationMs,
			appearance.setZoomOutDurationMs,
			appearance.connectedZoomGapMs,
			appearance.setConnectedZoomGapMs,
			appearance.connectedZoomDurationMs,
			appearance.setConnectedZoomDurationMs,
			appearance.zoomInEasing,
			appearance.setZoomInEasing,
			appearance.zoomOutEasing,
			appearance.setZoomOutEasing,
			appearance.connectedZoomEasing,
			appearance.setConnectedZoomEasing,
			appearance.loopCursor,
			appearance.setLoopCursor,
			appearance.cursorStyle,
			appearance.setCursorStyle,
			appearance.cursorSize,
			appearance.setCursorSize,
			appearance.cursorSmoothing,
			appearance.setCursorSmoothing,
			appearance.cursorSpringStiffnessMultiplier,
			appearance.setCursorSpringStiffnessMultiplier,
			appearance.cursorSpringDampingMultiplier,
			appearance.setCursorSpringDampingMultiplier,
			appearance.cursorSpringMassMultiplier,
			appearance.setCursorSpringMassMultiplier,
			appearance.cameraSpringStiffnessMultiplier,
			appearance.setCameraSpringStiffnessMultiplier,
			appearance.cameraSpringDampingMultiplier,
			appearance.setCameraSpringDampingMultiplier,
			appearance.cameraSpringMassMultiplier,
			appearance.setCameraSpringMassMultiplier,
			appearance.zoomClassicMode,
			appearance.setZoomClassicMode,
			appearance.cursorClickEffect,
			appearance.setCursorClickEffect,
			appearance.cursorClickEffectColor,
			appearance.setCursorClickEffectColor,
			appearance.cursorClickEffectScale,
			appearance.setCursorClickEffectScale,
			appearance.cursorClickEffectOpacity,
			appearance.setCursorClickEffectOpacity,
			appearance.cursorClickEffectDurationMs,
			appearance.setCursorClickEffectDurationMs,
			appearance.cursorClickBounce,
			appearance.setCursorClickBounce,
			appearance.cursorClickBounceDuration,
			appearance.setCursorClickBounceDuration,
			appearance.cursorSway,
			appearance.setCursorSway,
			appearance.keycastSettings,
			appearance.setKeycastSettings,
			appearance.borderRadius,
			appearance.setBorderRadius,
			appearance.padding,
			appearance.setPadding,
			appearance.cropRegion,
			appearance.setCropRegion,
			// `timeline` fields (also a new object literal each render).
			timeline.zoomRegions,
			timeline.selectedZoomId,
			timeline.clipRegions,
			timeline.audioRegions,
			timeline.selectedAudioId,
			timeline.selectedAnnotationId,
			timeline.annotationRegions,
			timeline.autoCaptions,
			timeline.autoCaptionSettings,
			timeline.setAutoCaptionSettings,
			timeline.selectedCaptionId,
			// command hooks: every callback this object exposes, individually.
			zoomCommands.handleZoomDepthChange,
			zoomCommands.handleZoomModeChange,
			zoomCommands.handleZoomDelete,
			clipCommands.handleClipSpeedChange,
			clipCommands.handleClipMutedChange,
			clipCommands.handleClipDelete,
			audioCommands.handleAudioVolumeChange,
			audioCommands.handleAudioNormalizeChange,
			audioCommands.handleAudioDelete,
			captionCommands.handleClearAutoCaptions,
			captionCommands.handleBeginCaptionEdit,
			captionCommands.handleCaptionTextEdit,
			captionCommands.handleCaptionRetime,
			captionCommands.handleCaptionSplit,
			captionCommands.handleCaptionMerge,
			captionCommands.handleCaptionDelete,
			annotationCommands.handleAnnotationContentChange,
			annotationCommands.handleAnnotationTypeChange,
			annotationCommands.handleAnnotationStyleChange,
			annotationCommands.handleAnnotationFigureDataChange,
			annotationCommands.handleAnnotationBlurIntensityChange,
			annotationCommands.handleAnnotationBlurColorChange,
			annotationCommands.handleAnnotationDelete,
			autoCaptionController.handlePickWhisperExecutable,
			autoCaptionController.handlePickWhisperModel,
			autoCaptionController.handleGenerateAutoCaptions,
			autoCaptionController.handleDownloadWhisperSmallModel,
			autoCaptionController.handleDeleteWhisperSmallModel,
		],
	);
}
