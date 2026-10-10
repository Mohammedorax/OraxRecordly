import {
	type Dispatch,
	type MutableRefObject,
	type RefObject,
	type SetStateAction,
	useCallback,
	useEffect,
} from "react";
import { toast } from "@/components/ui/toast";
import { useScopedT } from "@/contexts/I18nContext";
import { fromFileUrl, resolveVideoUrl } from "../projectPersistence";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useProjectState } from "../state/useProjectState";
import type { VideoPlaybackRef } from "../VideoPlayback";
import type { useProjectSaveActions } from "./useProjectSaveActions";

type Set<T> = Dispatch<SetStateAction<T>>;

type UseProjectOpenActionsInput = {
	project: ReturnType<typeof useProjectState>;
	appearance: ReturnType<typeof useAppearanceState>;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	pendingFreshRecordingAutoZoomPathRef: MutableRefObject<string | null>;
	hasUnsavedChanges: boolean;
	setIsPlaying: Set<boolean>;
	setCurrentTime: Set<number>;
	setDuration: Set<number>;
	applyLoadedProject: (candidate: unknown, path?: string | null) => Promise<boolean>;
	openUnsavedChangesDialog: (actionLabel: string) => Promise<"save" | "discard" | "cancel">;
	saveProject: ReturnType<typeof useProjectSaveActions>["saveProject"];
	refreshProjectLibrary: () => Promise<void>;
	resetSourceScopedEditorState: () => void;
	applySessionPresentation: (session: null) => void;
	handleSaveProject: () => Promise<unknown>;
	handleSaveProjectAs: () => Promise<unknown>;
};

export function useProjectOpenActions({
	project,
	appearance,
	videoPlaybackRef,
	pendingFreshRecordingAutoZoomPathRef,
	hasUnsavedChanges,
	setIsPlaying,
	setCurrentTime,
	setDuration,
	applyLoadedProject,
	openUnsavedChangesDialog,
	saveProject,
	refreshProjectLibrary,
	resetSourceScopedEditorState,
	applySessionPresentation,
	handleSaveProject,
	handleSaveProjectAs,
}: UseProjectOpenActionsInput) {
	const t = useScopedT("editor");
	const confirmReplaceSourceWithUnsavedChanges = useCallback(
		async (actionLabel: string) => {
			if (!hasUnsavedChanges) return true;
			const decision = await openUnsavedChangesDialog(actionLabel);
			if (decision === "discard") return true;
			if (decision === "save") return saveProject(false);
			return false;
		},
		[hasUnsavedChanges, openUnsavedChangesDialog, saveProject],
	);

	// Loads a media file (a recording, or a file the user picked) as the editor's
	// source. Shared by "import media" and by the dashboard's "edit recording"
	// action, so both leave the editor in exactly the same state.
	const loadSourcePathIntoEditor = useCallback(
		async (sourcePath: string) => {
			const setPathResult = await window.electronAPI.setCurrentVideoPath(sourcePath, {
				preserveProjectPath: false,
			});
			if (!setPathResult.success) {
				throw new Error(t("project.mediaLoadFailed", "Could not load media"));
			}
			const sourceVideoUrl = await resolveVideoUrl(sourcePath);
			try {
				videoPlaybackRef.current?.pause();
			} catch {
				// The preview may already be tearing down.
			}
			setIsPlaying(false);
			setCurrentTime(0);
			setDuration(0);
			project.setVideoSourcePath(sourcePath);
			project.setVideoPath(sourceVideoUrl);
			project.setCurrentProjectPath(null);
			project.setLastSavedSnapshot(null);
			resetSourceScopedEditorState();
			pendingFreshRecordingAutoZoomPathRef.current =
				appearance.autoApplyFreshRecordingAutoZooms ? sourceVideoUrl : null;
			applySessionPresentation(null);
			project.setProjectBrowserOpen(false);
			await refreshProjectLibrary();
		},
		[
			appearance.autoApplyFreshRecordingAutoZooms,
			applySessionPresentation,
			pendingFreshRecordingAutoZoomPathRef,
			project,
			refreshProjectLibrary,
			resetSourceScopedEditorState,
			setCurrentTime,
			setDuration,
			setIsPlaying,
			t,
			videoPlaybackRef,
		],
	);

	/** Opens a raw recording from the dashboard in the editor, ready to edit. */
	const handleOpenRecordingInEditor = useCallback(
		async (recordingPath: string) => {
			const actionLabel = t("project.actionEditRecording", "edit this recording");
			if (!(await confirmReplaceSourceWithUnsavedChanges(actionLabel))) return;
			try {
				await loadSourcePathIntoEditor(recordingPath);
				toast.success(t("project.recordingOpened", "Recording opened in the editor"));
			} catch (error) {
				project.setError(
					t("project.fileLoadError", "Could not load file: {{message}}", {
						message: error instanceof Error ? error.message : String(error),
					}),
				);
			}
		},
		[confirmReplaceSourceWithUnsavedChanges, loadSourcePathIntoEditor, project, t],
	);

	const handleOpenProjectFromLibrary = useCallback(
		async (projectPath: string) => {
			const actionLabel = t("project.actionOpenAnotherProject", "open another project");
			if (!(await confirmReplaceSourceWithUnsavedChanges(actionLabel))) return;
			try {
				const result = await window.electronAPI.openProjectFileAtPath(projectPath);
				if (result.canceled) return;
				if (!result.success) {
					// A project whose recording was moved or deleted can never open.
					// Say that in plain language instead of echoing a file path, and
					// refresh the library so the unusable entry disappears.
					if (result.code === "media-missing") {
						project.setError(
							t(
								"project.mediaMissing",
								"The recording this project was built from is no longer on disk, so it cannot be opened. It was moved or deleted; the project has been removed from your recent list.",
							),
						);
						await refreshProjectLibrary();
						return;
					}
					project.setError(
						result.error ||
							result.message ||
							t("project.loadFailed", "Failed to load project"),
					);
					return;
				}
				if (!(await applyLoadedProject(result.project, result.path ?? null))) {
					project.setError(
						t(
							"project.invalidFormat",
							"Could not load project: invalid project file format",
						),
					);
					return;
				}
				project.setProjectBrowserOpen(false);
				await refreshProjectLibrary();
				return true;
			} catch (error) {
				project.setError(
					t("project.loadError", "Could not load project: {{message}}", {
						message: error instanceof Error ? error.message : String(error),
					}),
				);
			}
		},
		[
			applyLoadedProject,
			confirmReplaceSourceWithUnsavedChanges,
			project,
			refreshProjectLibrary,
			t,
		],
	);

	const handleImportMediaOrProject = useCallback(async () => {
		const actionLabel = t("project.actionImportAFile", "import a file");
		if (!(await confirmReplaceSourceWithUnsavedChanges(actionLabel))) return;
		try {
			const result = await window.electronAPI.openVideoFilePicker({ includeProjects: true });
			if (result.canceled) return;
			if (!result.success) {
				toast.error(result.message || t("project.importFailed", "Failed to import file"));
				return;
			}
			if (result.kind === "project" || result.project) {
				if (!(await applyLoadedProject(result.project, result.path ?? null))) {
					project.setError(
						t(
							"project.invalidFormat",
							"Could not load project: invalid project file format",
						),
					);
					return;
				}
				project.setProjectBrowserOpen(false);
				await refreshProjectLibrary();
				toast.success(
					result.path
						? t("project.loadedFrom", "Project loaded from {{path}}", {
								path: result.path,
							})
						: t("project.loaded", "Project loaded"),
				);
				return;
			}
			if (!result.path) {
				toast.error(t("project.noMediaSelected", "No media file selected"));
				return;
			}

			await loadSourcePathIntoEditor(fromFileUrl(result.path));
			toast.success(t("project.mediaImported", "Media imported"));
		} catch (error) {
			project.setError(
				t("project.fileLoadError", "Could not load file: {{message}}", {
					message: error instanceof Error ? error.message : String(error),
				}),
			);
		}
	}, [
		confirmReplaceSourceWithUnsavedChanges,
		applyLoadedProject,
		loadSourcePathIntoEditor,
		project,
		refreshProjectLibrary,
		t,
	]);

	const handleOpenProjectBrowser = useCallback(async () => {
		if (project.projectBrowserOpen) {
			project.setProjectBrowserOpen(false);
			return;
		}
		videoPlaybackRef.current?.pause();
		setIsPlaying(false);
		if (project.videoPath && !project.error) {
			await saveProject(false, { remountPreviewAfterSave: false });
		}
		project.setProjectBrowserOpen(true);
		void refreshProjectLibrary();
	}, [
		project.projectBrowserOpen,
		project.setProjectBrowserOpen,
		refreshProjectLibrary,
		videoPlaybackRef,
		setIsPlaying,
		saveProject,
		project.videoPath,
		project.error,
	]);

	useEffect(() => {
		const openRequestedDashboard = () => {
			if (!localStorage.getItem("recordly.open-dashboard")) return;
			localStorage.removeItem("recordly.open-dashboard");
			if (!project.projectBrowserOpen) void handleOpenProjectBrowser();
		};
		openRequestedDashboard();
		window.addEventListener("storage", openRequestedDashboard);
		return () => window.removeEventListener("storage", openRequestedDashboard);
	}, [handleOpenProjectBrowser, project.projectBrowserOpen]);

	useEffect(() => {
		const removeLoad = window.electronAPI.onMenuLoadProject(
			() => void handleOpenProjectBrowser(),
		);
		const removeSave = window.electronAPI.onMenuSaveProject(handleSaveProject);
		const removeSaveAs = window.electronAPI.onMenuSaveProjectAs(handleSaveProjectAs);
		return () => {
			removeLoad?.();
			removeSave?.();
			removeSaveAs?.();
		};
	}, [handleOpenProjectBrowser, handleSaveProject, handleSaveProjectAs]);

	const handleDeleteProjects = useCallback(
		async (paths: string[]) => {
			const result = await window.electronAPI.trashProjectFiles(paths);
			if (project.currentProjectPath && result.deleted.includes(project.currentProjectPath)) {
				project.setCurrentProjectPath(null);
				project.setLastSavedSnapshot(null);
			}
			await refreshProjectLibrary();
			if (result.errors.length) toast.error(result.errors.join("\n"));
			return result.deleted;
		},
		[project, refreshProjectLibrary],
	);
	const handleRenameLibraryProject = useCallback(
		async (path: string, name: string) => {
			const result = await window.electronAPI.renameLibraryProject(path, name);
			if (!result.success || !result.path)
				throw new Error(
					result.error || t("project.renameFailed", "Could not rename project"),
				);
			if (project.currentProjectPath === path) project.setCurrentProjectPath(result.path);
			await refreshProjectLibrary();
			return result.path;
		},
		[project, refreshProjectLibrary, t],
	);

	return {
		handleRenameLibraryProject,
		handleOpenProjectFromLibrary,
		handleOpenRecordingInEditor,
		handleImportMediaOrProject,
		handleOpenProjectBrowser,
		handleDeleteProjects,
	};
}
