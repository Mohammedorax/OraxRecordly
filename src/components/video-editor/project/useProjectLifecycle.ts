/* biome-ignore-all lint/correctness/useExhaustiveDependencies: editor domain setters and refs are stable. */
import {
	type Dispatch,
	type MutableRefObject,
	type RefObject,
	type SetStateAction,
	useCallback,
	useMemo,
	useRef,
} from "react";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import type { useExportSettings } from "../export/useExportSettings";
import type { UnsavedChangesDecision } from "../layout/EditorDialogs";
import {
	createProjectData,
	deriveNextId,
	fromFileUrl,
	getDefaultBorderRadiusPercent,
	legacyBorderRadiusPixelsToPercent,
	normalizeProjectEditor,
	resolveVideoUrl,
	stripPersistedDevMotionBlurSettings,
	validateProjectData,
} from "../projectPersistence";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useProjectState } from "../state/useProjectState";
import type { useTimelineState } from "../state/useTimelineState";
import type { VideoPlaybackRef } from "../VideoPlayback";
import { cloneStructured } from "../videoEditorUtils";

type Input = {
	t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string;
	project: ReturnType<typeof useProjectState>;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	exportSettings: ReturnType<typeof useExportSettings>;
	aspectRatio: AspectRatio;
	setAspectRatio: Dispatch<SetStateAction<AspectRatio>>;
	currentSourcePath: string | null;
	currentPersistedEditorState: Parameters<typeof createProjectData>[1];
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	setIsPlaying: Dispatch<SetStateAction<boolean>>;
	setCurrentTime: Dispatch<SetStateAction<number>>;
	setDuration: Dispatch<SetStateAction<number>>;
	applySessionPresentation: (
		session:
			| { hideOverlayCursorByDefault?: boolean; nativeCaptureUnavailable?: boolean }
			| null
			| undefined,
	) => void;
	buildPersistedEditorState: (
		editor: Parameters<typeof createProjectData>[1],
	) => Parameters<typeof createProjectData>[1];
	resetHistory: () => void;
	refs: {
		nextZoomIdRef: MutableRefObject<number>;
		nextClipIdRef: MutableRefObject<number>;
		nextAudioIdRef: MutableRefObject<number>;
		nextAnnotationIdRef: MutableRefObject<number>;
		nextAnnotationZIndexRef: MutableRefObject<number>;
		clipInitializedRef: MutableRefObject<boolean>;
		autoFullTrackClipIdRef: MutableRefObject<string | null>;
		autoFullTrackClipEndMsRef: MutableRefObject<number | null>;
		pendingFreshRecordingAutoZoomPathRef: MutableRefObject<string | null>;
		pendingFreshRecordingAutoSuggestTelemetryCountRef: MutableRefObject<number>;
		autoSuggestedVideoPathRef: MutableRefObject<string | null>;
	};
};

export function useProjectLifecycle(input: Input) {
	const { project } = input;
	const inputRef = useRef(input);
	inputRef.current = input;
	const pendingSaveDialogRef = useRef<{ resolve(saved: boolean): void } | null>(null);
	const pendingUnsavedDialogRef = useRef<{
		resolve(decision: UnsavedChangesDecision): void;
	} | null>(null);

	const applyLoadedProject = useCallback(async (candidate: unknown, path?: string | null) => {
		const current = inputRef.current;
		const { project, appearance, timeline, exportSettings, refs } = current;
		if (!validateProjectData(candidate)) return false;
		const loadedProject = candidate;
		const sourcePath = fromFileUrl(loadedProject.videoPath);
		const persistedEditor = stripPersistedDevMotionBlurSettings(loadedProject.editor ?? {});
		const editor = normalizeProjectEditor({
			...persistedEditor,
			borderRadius:
				loadedProject.version < 2 && typeof persistedEditor.borderRadius === "number"
					? persistedEditor.borderRadius === 0
						? getDefaultBorderRadiusPercent()
						: legacyBorderRadiusPixelsToPercent(persistedEditor.borderRadius)
					: persistedEditor.borderRadius,
		});
		try {
			current.videoPlaybackRef.current?.pause();
		} catch {
			/* preview may be tearing down */
		}
		current.setIsPlaying(false);
		current.setCurrentTime(0);
		current.setDuration(0);
		project.setError(null);

		refs.pendingFreshRecordingAutoZoomPathRef.current = null;
		const result = await window.electronAPI.setCurrentVideoPath(sourcePath, {
			preserveProjectPath: Boolean(path),
		});
		if (!result.success)
			throw new Error(
				current.t("editor.project.projectMediaLoadFailed", "Could not load project media"),
			);
		current.applySessionPresentation(null);
		const videoUrl = await resolveVideoUrl(sourcePath);
		project.setVideoSourcePath(sourcePath);
		project.setCurrentProjectPath(path ?? null);
		project.setVideoPath(videoUrl);

		appearance.setWallpaper(editor.wallpaper);
		appearance.setShadowIntensity(editor.shadowIntensity);
		appearance.setBackgroundBlur(editor.backgroundBlur);
		appearance.setZoomMotionBlur(editor.zoomMotionBlur);
		appearance.setZoomMotionBlurTuning({ ...editor.zoomMotionBlurTuning });
		appearance.setConnectZooms(editor.connectZooms);
		appearance.setZoomInDurationMs(editor.zoomInDurationMs);
		appearance.setZoomInOverlapMs(editor.zoomInOverlapMs);
		appearance.setZoomOutDurationMs(editor.zoomOutDurationMs);
		appearance.setConnectedZoomGapMs(editor.connectedZoomGapMs);
		appearance.setConnectedZoomDurationMs(editor.connectedZoomDurationMs);
		appearance.setZoomInEasing(editor.zoomInEasing);
		appearance.setZoomOutEasing(editor.zoomOutEasing);
		appearance.setConnectedZoomEasing(editor.connectedZoomEasing);
		appearance.setShowCursor(editor.showCursor);
		appearance.setLoopCursor(editor.loopCursor);
		appearance.setCursorStyle(editor.cursorStyle);
		appearance.setCursorSize(editor.cursorSize);
		appearance.setCursorSmoothing(editor.cursorSmoothing);
		appearance.setCursorSpringStiffnessMultiplier(editor.cursorSpringStiffnessMultiplier);
		appearance.setCursorSpringDampingMultiplier(editor.cursorSpringDampingMultiplier);
		appearance.setCursorSpringMassMultiplier(editor.cursorSpringMassMultiplier);
		appearance.setCameraSpringStiffnessMultiplier(editor.cameraSpringStiffnessMultiplier);
		appearance.setCameraSpringDampingMultiplier(editor.cameraSpringDampingMultiplier);
		appearance.setCameraSpringMassMultiplier(editor.cameraSpringMassMultiplier);
		appearance.setCursorClickEffect(editor.cursorClickEffect);
		appearance.setCursorClickEffectColor(editor.cursorClickEffectColor);
		appearance.setCursorClickEffectScale(editor.cursorClickEffectScale);
		appearance.setCursorClickEffectOpacity(editor.cursorClickEffectOpacity);
		appearance.setCursorClickEffectDurationMs(editor.cursorClickEffectDurationMs);
		appearance.setZoomSmoothness(editor.zoomSmoothness);
		appearance.setZoomClassicMode(editor.zoomClassicMode);
		appearance.setCursorMotionBlur(editor.cursorMotionBlur);
		appearance.setCursorClickBounce(editor.cursorClickBounce);
		appearance.setCursorClickBounceDuration(editor.cursorClickBounceDuration);
		appearance.setCursorSway(editor.cursorSway);
		appearance.setBorderRadius(editor.borderRadius);
		appearance.setPadding(editor.padding);
		appearance.setCropRegion(editor.cropRegion);
		timeline.setZoomRegions(editor.zoomRegions);
		timeline.setTrimRegions(editor.trimRegions);
		timeline.setClipRegions(editor.clipRegions);
		// An explicit empty clip list means the user deleted all footage, not a legacy project.
		refs.clipInitializedRef.current = Array.isArray(persistedEditor.clipRegions);
		refs.autoFullTrackClipIdRef.current = null;
		refs.autoFullTrackClipEndMsRef.current = null;
		timeline.setSpeedRegions(editor.speedRegions);
		timeline.setAnnotationRegions(editor.annotationRegions);
		timeline.setAudioRegions(editor.audioRegions);
		timeline.setSourceAudioTrackSettingsByClip(editor.sourceAudioTrackSettingsByClip ?? {});
		timeline.setDefaultSourceAudioTrackSettings(editor.defaultSourceAudioTrackSettings ?? {});
		timeline.setAutoCaptions(editor.autoCaptions);
		timeline.setAutoCaptionSettings(editor.autoCaptionSettings);
		current.setAspectRatio(editor.aspectRatio);
		exportSettings.setExportEncodingMode(editor.exportEncodingMode);
		exportSettings.setExportBackendPreference(editor.exportBackendPreference);
		exportSettings.setExportPipelineModel(editor.exportPipelineModel);
		exportSettings.setExportQuality(editor.exportQuality);
		exportSettings.setMp4FrameRate(editor.mp4FrameRate);
		exportSettings.setExportFormat(editor.exportFormat);
		exportSettings.setGifFrameRate(editor.gifFrameRate);
		exportSettings.setGifLoop(editor.gifLoop);
		exportSettings.setGifSizePreset(editor.gifSizePreset);
		timeline.setSelectedZoomId(null);
		timeline.setSelectedClipId(null);
		timeline.setSelectedAnnotationId(null);
		timeline.setSelectedAudioId(null);
		refs.nextZoomIdRef.current = deriveNextId(
			"zoom",
			editor.zoomRegions.map(({ id }) => id),
		);
		refs.nextClipIdRef.current = deriveNextId(
			"clip",
			editor.clipRegions.map(({ id }) => id),
		);
		refs.nextAudioIdRef.current = deriveNextId(
			"audio",
			editor.audioRegions.map(({ id }) => id),
		);
		refs.nextAnnotationIdRef.current = deriveNextId(
			"annotation",
			editor.annotationRegions.map(({ id }) => id),
		);
		refs.nextAnnotationZIndexRef.current =
			editor.annotationRegions.reduce((max, region) => Math.max(max, region.zIndex), 0) + 1;
		current.resetHistory();
		project.setLastSavedSnapshot(
			cloneStructured(
				createProjectData(
					sourcePath,
					current.buildPersistedEditorState(editor),
					loadedProject.projectId ?? null,
				),
			),
		);
		// The library listing is not part of the project load: `useInitialEditorSource`
		// clears `loading` (and therefore the first usable frame) only after this
		// resolves, and every path that shows the library refreshes it on open.
		return true;
	}, []);

	const currentProjectSnapshot = useMemo(
		() =>
			input.currentSourcePath
				? createProjectData(
						input.currentSourcePath,
						input.currentPersistedEditorState,
						project.lastSavedSnapshot?.projectId ?? null,
					)
				: null,
		[
			input.currentSourcePath,
			input.currentPersistedEditorState,
			project.lastSavedSnapshot?.projectId,
		],
	);
	const resolveProjectSaveDialog = useCallback(
		(saved: boolean) => {
			const pending = pendingSaveDialogRef.current;
			pendingSaveDialogRef.current = null;
			project.setProjectSaveDialogOpen(false);
			project.setIsSavingProjectDialog(false);
			pending?.resolve(saved);
		},
		[project.setProjectSaveDialogOpen, project.setIsSavingProjectDialog],
	);
	const openProjectSaveDialog = useCallback(
		(initialName: string) => {
			pendingSaveDialogRef.current?.resolve(false);
			project.setProjectSaveDialogDraft(initialName);
			project.setProjectSaveDialogOpen(true);
			project.setIsSavingProjectDialog(false);
			return new Promise<boolean>((resolve) => {
				pendingSaveDialogRef.current = { resolve };
			});
		},
		[
			project.setProjectSaveDialogDraft,
			project.setProjectSaveDialogOpen,
			project.setIsSavingProjectDialog,
		],
	);
	const resolveUnsavedChangesDialog = useCallback(
		(decision: UnsavedChangesDecision) => {
			const pending = pendingUnsavedDialogRef.current;
			pendingUnsavedDialogRef.current = null;
			project.setUnsavedChangesDialogOpen(false);
			pending?.resolve(decision);
		},
		[project.setUnsavedChangesDialogOpen],
	);
	const openUnsavedChangesDialog = useCallback(
		(actionLabel: string) => {
			pendingUnsavedDialogRef.current?.resolve("cancel");
			project.setUnsavedChangesDialogActionLabel(actionLabel);
			project.setUnsavedChangesDialogOpen(true);
			return new Promise<UnsavedChangesDecision>((resolve) => {
				pendingUnsavedDialogRef.current = { resolve };
			});
		},
		[project.setUnsavedChangesDialogActionLabel, project.setUnsavedChangesDialogOpen],
	);

	const syncActiveVideoSource = useCallback(
		async (sourcePath: string) => {
			await window.electronAPI.setCurrentVideoPath(sourcePath, {
				preserveProjectPath: Boolean(project.currentProjectPath),
			});
		},
		[project.currentProjectPath],
	);
	const resetSourceScopedEditorState = useCallback(() => {
		const current = inputRef.current;
		const { timeline, refs } = current;
		timeline.setZoomRegions([]);
		timeline.setTrimRegions([]);
		timeline.setClipRegions([]);
		refs.clipInitializedRef.current = false;
		refs.autoFullTrackClipIdRef.current = null;
		refs.autoFullTrackClipEndMsRef.current = null;
		timeline.setSpeedRegions([]);
		timeline.setAnnotationRegions([]);
		timeline.setAudioRegions([]);
		timeline.setCursorTelemetry([]);
		timeline.setCursorTelemetrySourcePath(null);
		timeline.setSourceAudioTrackSettingsByClip({});
		timeline.setDefaultSourceAudioTrackSettings({});
		timeline.setAutoCaptions([]);
		timeline.setAutoCaptionSettings((previous) => ({ ...previous, enabled: false }));
		timeline.setSelectedZoomId(null);
		timeline.setSelectedClipId(null);
		timeline.setSelectedAnnotationId(null);
		timeline.setSelectedAudioId(null);
		refs.nextZoomIdRef.current = 1;
		refs.nextClipIdRef.current = 1;
		refs.nextAudioIdRef.current = 1;
		refs.nextAnnotationIdRef.current = 1;
		refs.nextAnnotationZIndexRef.current = 1;
		refs.pendingFreshRecordingAutoSuggestTelemetryCountRef.current = 0;
		refs.autoSuggestedVideoPathRef.current = null;
		current.resetHistory();
	}, []);

	return {
		applyLoadedProject,
		currentProjectSnapshot,
		resolveProjectSaveDialog,
		openProjectSaveDialog,
		resolveUnsavedChangesDialog,
		openUnsavedChangesDialog,
		syncActiveVideoSource,
		resetSourceScopedEditorState,
	};
}
