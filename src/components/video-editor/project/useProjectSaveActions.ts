import { moveProjectFolderReferences } from "../dashboard/useProjectFolders";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { toast } from "@/components/ui/toast";
import { useScopedT } from "@/contexts/I18nContext";
import { createProjectData, type EditorProjectData } from "../projectPersistence";
import type { useProjectState } from "../state/useProjectState";
import { cloneStructured, getErrorMessage } from "../videoEditorUtils";

const PROJECT_AUTOSAVE_DELAY_MS = 750;

type SaveProjectOptions = {
	silent?: boolean;
	remountPreviewAfterSave?: boolean;
	refreshLibraryAfterSave?: boolean;
	captureThumbnail?: boolean;
};

type UseProjectSaveActionsInput = {
	project: ReturnType<typeof useProjectState>;
	currentSourcePath: string | null;
	/** Video URL the preview is currently bound to (the preview key includes it). */
	previewSource: string | null;
	currentProjectSnapshot: EditorProjectData | null;
	currentPersistedEditorState: Parameters<typeof createProjectData>[1];
	projectDisplayName: string;
	hasUnsavedChanges: boolean;
	projectSaveDialogInputRef: RefObject<HTMLInputElement | null>;
	projectNameInputRef: RefObject<HTMLInputElement | null>;
	openProjectSaveDialog: (initialName: string) => Promise<boolean>;
	resolveProjectSaveDialog: (saved: boolean) => void;
	captureProjectThumbnail: () => Promise<string | null>;
	refreshProjectLibrary: () => Promise<void>;
	remountPreview: () => void;
};

export function useProjectSaveActions({
	project,
	currentSourcePath,
	previewSource,
	currentProjectSnapshot,
	currentPersistedEditorState,
	projectDisplayName,
	hasUnsavedChanges,
	projectSaveDialogInputRef,
	projectNameInputRef,
	openProjectSaveDialog,
	resolveProjectSaveDialog,
	captureProjectThumbnail,
	refreshProjectLibrary,
	remountPreview,
}: UseProjectSaveActionsInput) {
	const t = useScopedT("editor");
	const {
		currentProjectPath,
		lastSavedSnapshot,
		projectSaveDialogDraft,
		projectNameDraft,
		setCurrentProjectPath,
		setLastSavedSnapshot,
		setIsSavingProjectDialog,
		setProjectNameDraft,
		setIsEditingProjectName,
		setIsSavingProjectName,
		setProjectBrowserOpen,
	} = project;
	const savingNameRef = useRef(false);
	const activePathRef = useRef(currentProjectPath);
	const activeSourceRef = useRef(currentSourcePath);
	const activePreviewSourceRef = useRef(previewSource);
	useLayoutEffect(() => {
		activePathRef.current = currentProjectPath;
	}, [currentProjectPath]);
	useLayoutEffect(() => {
		activeSourceRef.current = currentSourcePath;
	}, [currentSourcePath]);
	useLayoutEffect(() => {
		activePreviewSourceRef.current = previewSource;
	}, [previewSource]);
	const autosaveTimeoutRef = useRef<number | null>(null);
	const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
	const clearPendingAutosave = useCallback(() => {
		if (autosaveTimeoutRef.current !== null) {
			window.clearTimeout(autosaveTimeoutRef.current);
			autosaveTimeoutRef.current = null;
		}
	}, []);
	const queueSave = useCallback((task: () => Promise<boolean>) => {
		const run = saveQueueRef.current.catch(() => undefined).then(task);
		saveQueueRef.current = run.catch(() => undefined);
		return run;
	}, []);
	/**
	 * Saving writes the project file/thumbnail and never rebinds the preview
	 * video element, so rebuilding the preview (new WebGL context, shader
	 * recompiles, video reload, visible blink) is only warranted when the bound
	 * source actually changed while the save was in flight.
	 */
	const shouldRemountPreviewAfterSave = useCallback(
		(remount: boolean, previousSource: string | null) =>
			remount && activePreviewSourceRef.current !== previousSource,
		[],
	);

	const saveProject = useCallback(
		async (forceSaveAs: boolean, options?: SaveProjectOptions) => {
			clearPendingAutosave();
			if (forceSaveAs)
				return openProjectSaveDialog(
					projectDisplayName || t("project.untitled", "Untitled Project"),
				);
			return queueSave(async () => {
				if (activeSourceRef.current !== currentSourcePath) return false;
				if (!currentSourcePath) {
					if (!options?.silent)
						toast.error(t("project.noVideoLoaded", "No video loaded"));
					return false;
				}

				const captureThumbnail = options?.captureThumbnail ?? true;
				const refreshLibrary = options?.refreshLibraryAfterSave ?? true;
				const remount = options?.remountPreviewAfterSave ?? true;
				const previewSourceBeforeSave = activePreviewSourceRef.current;
				try {
					const projectData =
						currentProjectSnapshot?.videoPath === currentSourcePath
							? currentProjectSnapshot
							: createProjectData(
									currentSourcePath,
									currentPersistedEditorState,
									lastSavedSnapshot?.projectId ?? null,
								);
					const fileNameBase =
						currentSourcePath
							.split(/[\\/]/)
							.pop()
							?.replace(/\.[^.]+$/, "") || `project-${Date.now()}`;
					const targetPath = forceSaveAs
						? undefined
						: (activePathRef.current ?? undefined);

					const thumbnail = captureThumbnail
						? ((await captureProjectThumbnail()) ?? undefined)
						: undefined;
					const result = !targetPath
						? await window.electronAPI.createProjectFile(projectData, thumbnail)
						: await window.electronAPI.saveProjectFile(
								projectData,
								fileNameBase,
								targetPath,
								thumbnail,
							);
					if (result.canceled) {
						if (!options?.silent)
							toast.info(t("project.saveCanceled", "Project save canceled"));
						return false;
					}
					if (!result.success) {
						toast.error(
							result.message || t("project.saveFailed", "Failed to save project"),
						);
						return false;
					}

					if (activeSourceRef.current !== currentSourcePath) return true;
					if (result.path) {
						activePathRef.current = result.path;
						setCurrentProjectPath(result.path);
					}
					setLastSavedSnapshot(
						cloneStructured(
							createProjectData(
								projectData.videoPath,
								projectData.editor,
								result.projectId ?? projectData.projectId ?? null,
							),
						),
					);
					if (refreshLibrary) await refreshProjectLibrary();

					return true;
				} catch (error) {
					toast.error(
						t("project.saveFailedDetail", "Could not save project: {{message}}", {
							message: getErrorMessage(error),
						}),
					);
					return false;
				} finally {
					if (shouldRemountPreviewAfterSave(remount, previewSourceBeforeSave)) {
						remountPreview();
					}
				}
			});
		},
		[
			clearPendingAutosave,
			queueSave,
			shouldRemountPreviewAfterSave,
			currentSourcePath,
			currentProjectSnapshot,
			currentPersistedEditorState,
			lastSavedSnapshot,
			setCurrentProjectPath,
			setLastSavedSnapshot,
			openProjectSaveDialog,
			projectDisplayName,
			captureProjectThumbnail,
			refreshProjectLibrary,
			remountPreview,
			t,
		],
	);

	useEffect(() => {
		window.electronAPI.setHasUnsavedChanges(hasUnsavedChanges);
	}, [hasUnsavedChanges]);
	useEffect(
		() => window.electronAPI.onRequestSaveBeforeClose(() => saveProject(false)),
		[saveProject],
	);
	useEffect(() => {
		if (
			project.projectBrowserOpen ||
			project.loading ||
			!currentSourcePath ||
			!hasUnsavedChanges
		) {
			clearPendingAutosave();
			return;
		}
		autosaveTimeoutRef.current = window.setTimeout(() => {
			autosaveTimeoutRef.current = null;
			void saveProject(false, {
				silent: true,
				remountPreviewAfterSave: false,
				refreshLibraryAfterSave: false,
				captureThumbnail: false,
			});
		}, PROJECT_AUTOSAVE_DELAY_MS);
		return clearPendingAutosave;
	}, [
		clearPendingAutosave,
		hasUnsavedChanges,
		saveProject,
		project.projectBrowserOpen,
		project.loading,
		currentSourcePath,
	]);
	useEffect(() => clearPendingAutosave, [clearPendingAutosave]);

	const saveProjectWithName = useCallback(
		async (name: string, mode: "rename" | "copy" = "rename") => {
			const trimmedName = name.trim();
			if (!trimmedName) {
				toast.error(t("project.nameRequired", "Project name is required"));
				return false;
			}
			if (!currentSourcePath) {
				toast.error(t("project.noVideoLoaded", "No video loaded"));
				return false;
			}
			clearPendingAutosave();
			return queueSave(async () => {
				if (activeSourceRef.current !== currentSourcePath) return false;
				const previewSourceBeforeSave = activePreviewSourceRef.current;
				try {
					const projectData =
						currentProjectSnapshot?.videoPath === currentSourcePath
							? currentProjectSnapshot
							: createProjectData(
									currentSourcePath,
									currentPersistedEditorState,
									lastSavedSnapshot?.projectId ?? null,
								);
					const previousPath = activePathRef.current;
					const result = await window.electronAPI.saveProjectFileNamed(
						projectData,
						trimmedName,
						await captureProjectThumbnail(),
						mode,
					);
					if (result.canceled) {
						toast.info(t("project.saveCanceled", "Project save canceled"));
						return false;
					}
					if (!result.success) {
						toast.error(
							result.message || t("project.saveFailed", "Failed to save project"),
						);
						return false;
					}
					if (activeSourceRef.current !== currentSourcePath) return true;
					if (
						mode === "rename" &&
						previousPath &&
						result.path &&
						previousPath !== result.path
					) {
						try {
							moveProjectFolderReferences(previousPath, result.path);
						} catch {
							toast.error(
								t(
									"project.renameLibraryUpdateFailed",
									"Project renamed, but library preferences could not be updated",
								),
							);
						}
					}
					if (result.path) {
						activePathRef.current = result.path;
						setCurrentProjectPath(result.path);
					}
					setLastSavedSnapshot(
						cloneStructured(
							createProjectData(
								projectData.videoPath,
								projectData.editor,
								result.projectId ?? projectData.projectId ?? null,
							),
						),
					);
					await refreshProjectLibrary();

					return true;
				} finally {
					if (shouldRemountPreviewAfterSave(true, previewSourceBeforeSave)) {
						remountPreview();
					}
				}
			});
		},
		[
			clearPendingAutosave,
			queueSave,
			shouldRemountPreviewAfterSave,
			currentSourcePath,
			currentProjectSnapshot,
			currentPersistedEditorState,
			lastSavedSnapshot,
			setCurrentProjectPath,
			setLastSavedSnapshot,
			captureProjectThumbnail,
			refreshProjectLibrary,
			remountPreview,
			t,
		],
	);

	const handleProjectSaveDialogSubmit = useCallback(
		async (event?: React.FormEvent<HTMLFormElement>) => {
			event?.preventDefault();
			const name = projectSaveDialogDraft.trim();
			if (!name) {
				toast.error(t("project.nameRequired", "Project name is required"));
				projectSaveDialogInputRef.current?.focus();
				return;
			}
			setIsSavingProjectDialog(true);
			let saved = false;
			try {
				saved = await saveProjectWithName(name, "copy");
			} catch (error) {
				toast.error(getErrorMessage(error));
			} finally {
				setIsSavingProjectDialog(false);
			}
			if (saved) resolveProjectSaveDialog(true);
			else {
				projectSaveDialogInputRef.current?.focus();
				projectSaveDialogInputRef.current?.select();
			}
		},
		[
			projectSaveDialogDraft,
			setIsSavingProjectDialog,
			projectSaveDialogInputRef,
			resolveProjectSaveDialog,
			saveProjectWithName,
			t,
		],
	);

	const closeProjectNameEditor = useCallback(() => {
		setProjectNameDraft(projectDisplayName);
		setIsEditingProjectName(false);
	}, [setProjectNameDraft, setIsEditingProjectName, projectDisplayName]);
	const handleProjectNameSubmit = useCallback(
		async (event?: React.FormEvent<HTMLFormElement>) => {
			event?.preventDefault();
			const name = projectNameDraft.trim();
			if (savingNameRef.current) return;
			if (!name || name === projectDisplayName) return closeProjectNameEditor();
			savingNameRef.current = true;
			setIsSavingProjectName(true);
			let saved = false;
			try {
				saved = await saveProjectWithName(name, "rename");
			} catch (error) {
				toast.error(getErrorMessage(error));
			} finally {
				setIsSavingProjectName(false);
				savingNameRef.current = false;
			}
			if (saved) setIsEditingProjectName(false);
			else {
				projectNameInputRef.current?.focus();
				projectNameInputRef.current?.select();
			}
		},
		[
			projectNameDraft,
			projectDisplayName,
			setIsSavingProjectName,
			setIsEditingProjectName,
			projectNameInputRef,
			closeProjectNameEditor,
			saveProjectWithName,
		],
	);
	const handleSaveProject = useCallback(() => saveProject(false), [saveProject]);
	const handleSaveProjectAs = useCallback(async () => {
		if (await saveProject(true)) setProjectBrowserOpen(false);
	}, [saveProject, setProjectBrowserOpen]);

	return {
		saveProject,
		handleSaveProject,
		handleSaveProjectAs,
		handleProjectSaveDialogSubmit,
		closeProjectNameEditor,
		handleProjectNameSubmit,
	};
}
