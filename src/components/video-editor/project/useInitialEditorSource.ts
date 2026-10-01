/* biome-ignore-all lint/correctness/useExhaustiveDependencies: editor state setters are stable and initial source loading intentionally runs once per launch configuration. */
import { type MutableRefObject, useEffect, useRef } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { fromFileUrl, resolveVideoUrl } from "../projectPersistence";
import type { getDevOpenRecordingConfig, getSmokeExportConfig } from "../smokeExportConfig";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useProjectState } from "../state/useProjectState";
import type { useTimelineState } from "../state/useTimelineState";

type SessionPresentation = {
	hideOverlayCursorByDefault?: boolean;
	nativeCaptureUnavailable?: boolean;
};

type Input = {
	project: ReturnType<typeof useProjectState>;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	smokeConfig: ReturnType<typeof getSmokeExportConfig>;
	devConfig: ReturnType<typeof getDevOpenRecordingConfig>;
	videoSourcePath: string | null;
	pendingFreshRecordingAutoZoomPathRef: MutableRefObject<string | null>;
	applyLoadedProject: (candidate: unknown, path?: string | null) => Promise<boolean>;
	resetSourceScopedEditorState: () => void;
	applySessionPresentation: (session: SessionPresentation | null | undefined) => void;
};

export function useInitialEditorSource({
	project,
	appearance,
	timeline,
	smokeConfig,
	devConfig,
	videoSourcePath,
	pendingFreshRecordingAutoZoomPathRef,
	applyLoadedProject,
	resetSourceScopedEditorState,
	applySessionPresentation,
}: Input) {
	const initialLoadStartedRef = useRef(false);
	const t = useScopedT("editor");

	useEffect(() => {
		// This effect owns launch-time hydration. Several of the callbacks it uses
		// intentionally close over live editor state, so their identities may change
		// after hydration updates that state. Never interpret that as a request to
		// reload the source and reset the editor again.
		if (initialLoadStartedRef.current) return;
		initialLoadStartedRef.current = true;

		async function loadInitialData() {
			try {
				if (smokeConfig.enabled && smokeConfig.projectPath) {
					const result = await window.electronAPI.openProjectFileAtPath(
						smokeConfig.projectPath,
					);
					if (!result.success || !result.project) {
						project.setError(
							t(
								"project.smokeLoadFailed",
								"Smoke export failed to load project {{path}}: {{message}}",
								{
									path: smokeConfig.projectPath,
									message:
										result.error ||
										result.message ||
										t("project.unknownError", "unknown error"),
								},
							),
						);
						return;
					}
					if (
						!(await applyLoadedProject(
							result.project,
							result.path ?? smokeConfig.projectPath,
						))
					) {
						project.setError(
							t(
								"project.smokeApplyFailed",
								"Smoke export could not apply project {{path}}",
								{ path: smokeConfig.projectPath },
							),
						);
						return;
					}
					project.setError(null);
					return;
				}

				if (!smokeConfig.enabled && devConfig.inputPath) {
					const sourcePath = fromFileUrl(devConfig.inputPath);
					await window.electronAPI.setCurrentVideoPath(sourcePath);
					const sourceUrl = await resolveVideoUrl(sourcePath);
					project.setVideoSourcePath(sourcePath);
					project.setVideoPath(sourceUrl);
					project.setCurrentProjectPath(null);
					project.setLastSavedSnapshot(null);
					resetSourceScopedEditorState();
					pendingFreshRecordingAutoZoomPathRef.current =
						appearance.autoApplyFreshRecordingAutoZooms ? sourceUrl : null;
					project.setError(null);
					return;
				}

				if (smokeConfig.enabled) {
					if (!smokeConfig.inputPath) {
						project.setError(
							t("project.smokeInputMissing", "Smoke export input path is missing."),
						);
						return;
					}
					const sourcePath = fromFileUrl(smokeConfig.inputPath);
					await window.electronAPI.setCurrentVideoPath(sourcePath);
					const sourceUrl = await resolveVideoUrl(sourcePath);
					project.setVideoSourcePath(sourcePath);
					project.setVideoPath(sourceUrl);
					project.setCurrentProjectPath(null);
					project.setLastSavedSnapshot(null);
					resetSourceScopedEditorState();
					pendingFreshRecordingAutoZoomPathRef.current = null;
					project.setError(null);
					return;
				}

				const currentProject = await window.electronAPI.loadCurrentProjectFile();
				if (
					currentProject.success &&
					currentProject.project &&
					(await applyLoadedProject(currentProject.project, currentProject.path ?? null))
				) {
					return;
				}

				const sessionResult = await window.electronAPI.getCurrentRecordingSession?.();
				if (sessionResult?.success && sessionResult.session?.videoPath) {
					const sourcePath = fromFileUrl(sessionResult.session.videoPath);
					const sourceUrl = await resolveVideoUrl(sourcePath);
					project.setVideoSourcePath(sourcePath);
					project.setVideoPath(sourceUrl);
					project.setCurrentProjectPath(null);
					project.setLastSavedSnapshot(null);
					resetSourceScopedEditorState();
					pendingFreshRecordingAutoZoomPathRef.current =
						appearance.autoApplyFreshRecordingAutoZooms ? sourceUrl : null;
					applySessionPresentation(sessionResult.session);
					return;
				}

				const currentVideo = await window.electronAPI.getCurrentVideoPath();
				if (!currentVideo.success || !currentVideo.path) {
					// An empty session is the normal dashboard launch, not a load failure.
					project.setProjectBrowserOpen(true);
					return;
				}
				const sourcePath = fromFileUrl(currentVideo.path);
				project.setVideoSourcePath(sourcePath);
				project.setVideoPath(await resolveVideoUrl(sourcePath));
				project.setCurrentProjectPath(null);
				project.setLastSavedSnapshot(null);
				resetSourceScopedEditorState();
				pendingFreshRecordingAutoZoomPathRef.current = null;
				applySessionPresentation(null);
			} catch (error) {
				project.setError(
					t("project.videoLoadError", "Error loading video: {{message}}", {
						message: String(error),
					}),
				);
			} finally {
				project.setLoading(false);
			}
		}
		void loadInitialData();
	}, [
		applyLoadedProject,
		applySessionPresentation,
		devConfig,
		resetSourceScopedEditorState,
		smokeConfig,
		t,
	]);

	useEffect(() => {
		if (!window.electronAPI.onRecordingSessionChanged) return;
		return window.electronAPI.onRecordingSessionChanged((session) => {
			const sessionSourcePath = session?.videoPath ? fromFileUrl(session.videoPath) : null;
			if (!session || sessionSourcePath !== videoSourcePath) return;
			timeline.setSourceAudioFallbackRefreshKey((key) => key + 1);
		});
	}, [videoSourcePath, timeline.setSourceAudioFallbackRefreshKey]);

	useEffect(() => {
		if (!appearance.autoApplyFreshRecordingAutoZooms) {
			pendingFreshRecordingAutoZoomPathRef.current = null;
		}
	}, [appearance.autoApplyFreshRecordingAutoZooms, pendingFreshRecordingAutoZoomPathRef]);
}
