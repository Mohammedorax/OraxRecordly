import { type ComponentProps, useCallback, useEffect, useMemo, useRef } from "react";
import { EditorAnnouncementBanner } from "@/components/announcements/EditorAnnouncementBanner";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/toast";
import type { useI18n } from "@/contexts/I18nContext";
import { RECORDING_DRAG_TYPE } from "@/types/recordingLibrary";
import { DashboardSettingsContext } from "../dashboard/DashboardSettings";
import type { useEditorExportController } from "../export/useEditorExportController";
import type { useExportDimensions } from "../export/useExportDimensions";
import type { useExportSession } from "../export/useExportSession";
import type { useExportSettings } from "../export/useExportSettings";
import { useRecordingActivity } from "../hooks/useRecordingActivity";
import type { useTimelineEditingController } from "../hooks/useTimelineEditingController";
import { useVideoSourceRecovery } from "../hooks/useVideoSourceRecovery";
import { RecordingLibraryPanel } from "../library/RecordingLibraryPanel";
import { useRecordingLibrary } from "../library/useRecordingLibrary";
import type { useEditorProjectController } from "../project/useEditorProjectController";
import { SettingsPanel } from "../SettingsPanel";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useEditorUiState } from "../state/useEditorUiState";
import type { useProjectState } from "../state/useProjectState";
import type { useTimelineState } from "../state/useTimelineState";
import type { EditorEffectSection } from "../types";
import { CropEditorDialog } from "./CropEditorDialog";
import { EditorDialogs } from "./EditorDialogs";
import { EditorHeader } from "./EditorHeader";
import { EditorLoadingSkeleton } from "./EditorLoadingSkeleton";
import { EditorPreviewPanel } from "./EditorPreviewPanel";
import { EditorShortcutBar } from "./EditorShortcutBar";
import { EditorSidebar } from "./EditorSidebar";
import { EditorTimelinePanel } from "./EditorTimelinePanel";

type Props = {
	t: ReturnType<typeof useI18n>["t"];
	project: ReturnType<typeof useProjectState>;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	ui: ReturnType<typeof useEditorUiState>;
	projectController: ReturnType<typeof useEditorProjectController>;
	editing: ReturnType<typeof useTimelineEditingController>;
	exportController: ReturnType<typeof useEditorExportController>;
	exportSettings: ReturnType<typeof useExportSettings>;
	exportSession: ReturnType<typeof useExportSession>;
	exportDimensions: ReturnType<typeof useExportDimensions>;
	settingsPanelProps: ComponentProps<typeof SettingsPanel>;
	headerLeftControlsPaddingClass: string;
	hasCaptionsForSidecar: boolean;
	nvidiaCudaExportAvailable: boolean;
	experimentalNvidiaCudaExport: boolean;
	setExperimentalNvidiaCudaExport: (enabled: boolean) => void;
	effectiveShowCursor: boolean;
	previewAspectRatioValue: number;
};

export function EditorShell(props: Props) {
	const {
		t,
		project,
		appearance,
		timeline,
		ui,
		projectController,
		editing,
		exportController,
		exportSettings,
		exportSession,
		exportDimensions,
		settingsPanelProps,
		headerLeftControlsPaddingClass,
		hasCaptionsForSidecar,
		nvidiaCudaExportAvailable,
		experimentalNvidiaCudaExport,
		setExperimentalNvidiaCudaExport,
		effectiveShowCursor,
		previewAspectRatioValue,
	} = props;
	const library = useRecordingLibrary(project, timeline, ui, appearance);
	const isRecordingActive = useRecordingActivity();
	// biome-ignore lint/correctness/useExhaustiveDependencies: Changing the active inspector closes the Videos view.
	useEffect(() => {
		library.setOpen(false);
	}, [ui.activeEffectSection, library.setOpen]);
	const timelinePanelRef = useRef<HTMLDivElement>(null);
	const wasImporting = useRef(false);
	useEffect(() => {
		if (wasImporting.current && !library.importing) timelinePanelRef.current?.focus();
		wasImporting.current = library.importing;
	}, [library.importing]);
	const { setIsPreviewReady, setPreviewVersion } = ui;
	// Stable identity keeps the memoized `EditorSidebar` (and the settings panel it
	// renders) from re-rendering on every playback frame; the setters it closes over are
	// React dispatchers, so this never observes stale state.
	const handleSelectEffectSection = useCallback(
		(section: EditorEffectSection) => {
			library.setOpen(false);
			timeline.setSelectedAnnotationId(null);
			timeline.setSelectedZoomId(null);
			timeline.setSelectedClipId(null);
			timeline.setSelectedAudioId(null);
			timeline.setSelectedCaptionId(null);
			ui.setActiveEffectSection(section);
		},
		[
			library.setOpen,
			timeline.setSelectedAnnotationId,
			timeline.setSelectedZoomId,
			timeline.setSelectedClipId,
			timeline.setSelectedAudioId,
			timeline.setSelectedCaptionId,
			ui.setActiveEffectSection,
		],
	);
	const remountRecoveredVideo = useCallback(() => {
		setIsPreviewReady(false);
		setPreviewVersion((version) => version + 1);
	}, [setIsPreviewReady, setPreviewVersion]);
	const handlePreviewError = useVideoSourceRecovery(project, remountRecoveredVideo);
	const {
		snapshot,
		history,
		lifecycle,
		autoCaption,
		saveActions,
		openActions,
		hasUnsavedChanges,
	} = projectController;
	const {
		cursor,
		projection,
		audio,
		playback,
		captionCommands,
		zoomCommands,
		clipCommands,
		audioCommands,
		annotationCommands,
		handleSelectAnnotation,
		handleAutoSuggestZoomsConsumed,
	} = editing;
	const { dialogActions, status: exportStatus, exportMessage } = exportController;
	const dashboardSettingsContent = useMemo(
		() => (
			<SettingsPanel
				{...settingsPanelProps}
				activeEffectSection="settings"
				selectedAnnotationId={null}
				selectedClipId={null}
				advanced
			/>
		),
		[settingsPanelProps],
	);
	const editorDialogs = (
		<DashboardSettingsContext.Provider value={dashboardSettingsContent}>
			<EditorDialogs
				t={t}
				projectSaveDialogOpen={project.projectSaveDialogOpen}
				setProjectSaveDialogOpen={project.setProjectSaveDialogOpen}
				projectSaveDialogDraft={project.projectSaveDialogDraft}
				setProjectSaveDialogDraft={project.setProjectSaveDialogDraft}
				projectSaveDialogInputRef={ui.projectSaveDialogInputRef}
				isSavingProjectDialog={project.isSavingProjectDialog}
				resolveProjectSaveDialog={lifecycle.resolveProjectSaveDialog}
				handleProjectSaveDialogSubmit={saveActions.handleProjectSaveDialogSubmit}
				unsavedChangesDialogOpen={project.unsavedChangesDialogOpen}
				setUnsavedChangesDialogOpen={project.setUnsavedChangesDialogOpen}
				unsavedChangesDialogActionLabel={project.unsavedChangesDialogActionLabel}
				resolveUnsavedChangesDialog={lifecycle.resolveUnsavedChangesDialog}
				projectBrowserOpen={project.projectBrowserOpen}
				setProjectBrowserOpen={project.setProjectBrowserOpen}
				projectLibraryEntries={project.projectLibraryEntries}
				projectError={project.error}
				onDeleteProjects={openActions.handleDeleteProjects}
				onRenameProject={openActions.handleRenameLibraryProject}
				handleImportMediaOrProject={openActions.handleImportMediaOrProject}
				handleOpenProjectFromLibrary={openActions.handleOpenProjectFromLibrary}
				onEditRecording={openActions.handleOpenRecordingInEditor}
				nativeCaptureUnavailableModalOpen={ui.nativeCaptureUnavailableModalOpen}
				setNativeCaptureUnavailableModalOpen={ui.setNativeCaptureUnavailableModalOpen}
			/>
		</DashboardSettingsContext.Provider>
	);
	if (project.loading && !project.error)
		return (
			<>
				<EditorLoadingSkeleton />
				{editorDialogs}
				<Toaster className="pointer-events-auto" />
			</>
		);
	if (project.error)
		return (
			<div className="flex h-screen items-center justify-center bg-background">
				<div className="flex flex-col items-center gap-3">
					<div role="alert" className="max-w-xl break-words text-center text-destructive">
						{project.error}
					</div>
					<Button
						variant="ghost"
						ref={ui.projectBrowserFallbackTriggerRef}
						type="button"
						onClick={openActions.handleOpenProjectBrowser}
						className="px-3 py-1.5 text-sm"
					>
						{t("editor.shell.openProjects", "Open Projects")}
					</Button>
				</div>
				{editorDialogs}
				<Toaster className="pointer-events-auto" />
			</div>
		);

	return (
		<div className="flex h-screen flex-col overflow-hidden bg-editor-bg text-foreground selection:bg-accent/20">
			<EditorHeader
				clipsOpen={library.open}
				onToggleClips={() => library.setOpen((open) => !open)}
				t={t}
				headerLeftControlsPaddingClass={headerLeftControlsPaddingClass}
				project={project}
				projectBrowserTriggerRef={ui.projectBrowserTriggerRef}
				projectNameInputRef={ui.projectNameInputRef}
				projectDisplayName={snapshot.projectDisplayName}
				hasUnsavedChanges={hasUnsavedChanges}
				canUndo={history.canUndo}
				canRedo={history.canRedo}
				handleOpenProjectBrowser={openActions.handleOpenProjectBrowser}
				handleUndo={history.handleUndo}
				handleRedo={history.handleRedo}
				handleProjectNameSubmit={saveActions.handleProjectNameSubmit}
				closeProjectNameEditor={saveActions.closeProjectNameEditor}
				exportSettings={exportSettings}
				exportSession={exportSession}
				exportDimensions={exportDimensions}
				exportStatus={exportStatus}
				hasCaptionsForSidecar={hasCaptionsForSidecar}
				effectiveDurationSec={ui.duration}
				nvidiaCudaExportAvailable={nvidiaCudaExportAvailable}
				experimentalNvidiaCudaExport={experimentalNvidiaCudaExport}
				setExperimentalNvidiaCudaExport={setExperimentalNvidiaCudaExport}
				handleOpenExportDropdown={dialogActions.handleOpenExportDropdown}
				handleExportDropdownClose={dialogActions.handleExportDropdownClose}
				handleCancelExport={dialogActions.handleCancelExport}
				handleRetrySaveExport={dialogActions.handleRetrySaveExport}
				handleStartExportFromDropdown={dialogActions.handleStartExportFromDropdown}
				revealExportedFile={dialogActions.revealExportedFile}
				exportMessage={exportMessage}
			/>
			<EditorAnnouncementBanner />
			{/* Quick control for the on-screen shortcuts; the row itself can be hidden. */}
			<EditorShortcutBar
				settings={appearance.keycastSettings}
				onChange={appearance.setKeycastSettings}
				isMac={/mac/i.test(navigator.platform)}
			/>
			<div
				className="relative flex min-h-0 flex-1 flex-col"
				onPointerDownCapture={(event) => {
					if ((event.target as HTMLElement).closest("[data-timeline-item]"))
						library.setOpen(false);
				}}
				onDragOver={(event) => {
					if (event.dataTransfer.types.includes(RECORDING_DRAG_TYPE)) {
						event.preventDefault();
						event.dataTransfer.dropEffect = "copy";
					}
				}}
				onDrop={(event) => {
					const path = event.dataTransfer.getData(RECORDING_DRAG_TYPE);
					if (!path) return;
					event.preventDefault();
					event.stopPropagation();
					const timelinePanel = (event.target as HTMLElement).closest(
						"[data-timeline-panel]",
					);
					let index: number | undefined;
					if (timelinePanel) {
						const clips = [
							...timelinePanel.querySelectorAll<HTMLElement>(
								'[data-timeline-item][data-variant="clip"]',
							),
						].sort((a, b) => Number(a.dataset.startMs) - Number(b.dataset.startMs));
						index = clips.findIndex((clip) => {
							const rect = clip.getBoundingClientRect();
							return event.clientX < rect.left + rect.width / 2;
						});
						if (index < 0) index = clips.length;
					}
					let paths: unknown;
					try {
						paths = JSON.parse(path);
					} catch {
						paths = [path];
					}
					if (
						Array.isArray(paths) &&
						paths.every((value) => typeof value === "string" && value.length > 0)
					)
						void library.addToTimeline(paths, index);
				}}
			>
				<div className="relative z-10 flex min-h-0 flex-1 pt-3">
					<EditorSidebar
						panelContent={
							library.open ? <RecordingLibraryPanel library={library} /> : undefined
						}
						t={t}
						activeSection={ui.activeEffectSection}
						setActiveSection={handleSelectEffectSection}
						settingsPanelProps={settingsPanelProps}
					/>
					<EditorPreviewPanel
						t={t}
						videoPath={project.videoPath}
						previewVersion={ui.previewVersion}
						aspectRatio={ui.aspectRatio}
						setAspectRatio={ui.setAspectRatio}
						previewAspectRatioValue={previewAspectRatioValue}
						videoPlaybackRef={ui.videoPlaybackRef}
						timelineRef={ui.timelineRef}
						currentTime={ui.currentTime}
						isPlaying={ui.isPlaying}
						previewVolume={ui.previewVolume}
						setPreviewVolume={ui.setPreviewVolume}
						// Recording shares the GPU and CPU with the capture encoder, so the
						// preview stops drawing while a recording runs.
						suspendRendering={
							exportStatus.shouldSuspendPreviewRendering || isRecordingActive
						}
						appearance={appearance}
						timeline={timeline}
						audio={audio}
						projection={projection}
						playback={playback}
						zoomCommands={zoomCommands}
						annotationCommands={annotationCommands}
						effectiveCursorTelemetry={cursor.effectiveCursorTelemetry}
						effectiveShowCursor={effectiveShowCursor}
						isCropped={ui.isCropped}
						handleOpenCropEditor={ui.handleOpenCropEditor}
						handleSaveAutoCaptionEdit={autoCaption.handleSaveAutoCaptionEdit}
						handleSelectAnnotation={handleSelectAnnotation}
						setDuration={ui.setDuration}
						isPreviewReady={ui.isPreviewReady}
						setIsPreviewReady={ui.setIsPreviewReady}
						setCurrentTime={ui.setCurrentTime}
						setIsPlaying={ui.setIsPlaying}
						setError={handlePreviewError}
					/>
				</div>
				<EditorTimelinePanel
					panelRef={timelinePanelRef}
					timelineRef={ui.timelineRef}
					timeline={timeline}
					projection={projection}
					playback={playback}
					audio={audio}
					zoomCommands={zoomCommands}
					clipCommands={clipCommands}
					audioCommands={audioCommands}
					captionCommands={captionCommands}
					annotationCommands={annotationCommands}
					videoPath={project.videoPath}
					videoSourcePath={project.videoSourcePath}
					cursorTelemetrySourcePath={timeline.cursorTelemetrySourcePath}
					normalizedCursorTelemetry={cursor.normalizedCursorTelemetry}
					autoSuggestZoomsTrigger={ui.autoSuggestZoomsTrigger}
					handleAutoSuggestZoomsConsumed={handleAutoSuggestZoomsConsumed}
					disableSuggestedZooms={!appearance.autoApplyFreshRecordingAutoZooms}
					currentTime={ui.currentTime}
					handleSelectAnnotation={handleSelectAnnotation}
				/>
			</div>
			{library.importing && (
				<div
					className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80"
					role="status"
					aria-live="polite"
				>
					<div className="rounded-xl border border-separator bg-background p-6 text-center">
						<p className="font-medium">{t("editor.cloud.addingVideo")}</p>
						<p className="mt-2 text-sm text-muted-foreground">
							{t("editor.cloud.preparingFootage")}
						</p>
						<Button
							className="mt-4"
							variant="ghost"
							size="sm"
							disabled={library.cancelling}
							onClick={() => void library.cancelImport()}
						>
							{t("common.actions.cancel", "Cancel")}
						</Button>
					</div>
				</div>
			)}
			{/* Compact progress pill: the export dialog can be closed while the
			    render keeps running, so keep the state and a cancel action visible. */}
			{exportSession.isExporting && !exportSession.showExportDropdown ? (
				<div
					className="pointer-events-auto fixed end-4 bottom-4 z-[90] flex items-center gap-3 rounded-full border border-white/10 bg-black/80 px-4 py-2 text-xs text-white shadow-lg backdrop-blur"
					role="status"
					aria-live="polite"
				>
					<span className="font-medium tabular-nums">
						{exportStatus.exportPercentLabel}
					</span>
					<span className="text-white/70">{exportStatus.runtimeLabel}</span>
					<Button
						variant="ghost"
						size="sm"
						className="h-7 px-3 text-white text-xs hover:bg-white/10"
						onClick={dialogActions.handleCancelExport}
					>
						{t("common.actions.cancel", "Cancel")}
					</Button>
				</div>
			) : null}
			{editorDialogs}
			<CropEditorDialog
				open={ui.showCropModal}
				t={t}
				videoElement={ui.videoPlaybackRef.current?.video ?? null}
				cropRegion={appearance.cropRegion}
				setCropRegion={appearance.setCropRegion}
				aspectRatio={ui.aspectRatio}
				onCancel={ui.handleCancelCropEditor}
				onDone={ui.handleCloseCropEditor}
			/>
			<Toaster className="pointer-events-auto" />
		</div>
	);
}
