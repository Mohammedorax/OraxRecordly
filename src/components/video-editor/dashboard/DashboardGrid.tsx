import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ImageSquare } from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";
import type { ProjectPreviewData } from "@/types/projectPreview";
import { DashboardSettings } from "./DashboardSettings";
import { ProjectCard } from "./ProjectCard";
import { ProjectHoverPreview } from "./ProjectHoverPreview";
import type { ProjectHoverPreviewReport } from "./ProjectThumbnail";
import { RawPreview } from "./RawRecordings";
import { RecordNewButton } from "./RecordNewButton";
import { ScreenshotGrid } from "./ScreenshotLibrary";
import type { DashboardProps } from "./types";

import type { DashboardModel } from "./useDashboardModel";

type PreviewOffset = {
	left: number;
	top: number;
	width: number;
	height: number;
};

/**
 * The single hover-preview host. Only one card can be previewing at a time, so
 * the grid — not each card — owns the renderer: hovering across the grid swaps
 * `data` on this entry instead of mounting and destroying a Pixi application per
 * card. `data` is retained after the hover ends so the host itself survives
 * between cards; `active` is what the DOM marker and playback follow.
 */
type PooledPreview = {
	key: string;
	data: ProjectPreviewData;
	offset: PreviewOffset | null;
	active: boolean;
};

/** Position of a thumbnail inside the (non-scrolling) grid box that hosts it. */
function measurePreviewOffset(element: HTMLElement, container: HTMLElement | null) {
	if (!container) return null;
	const elementRect = element.getBoundingClientRect();
	const containerRect = container.getBoundingClientRect();
	return {
		left: elementRect.left - containerRect.left,
		top: elementRect.top - containerRect.top,
		width: elementRect.width,
		height: elementRect.height,
	};
}

function sameOffset(left: PreviewOffset | null, right: PreviewOffset | null) {
	return (
		!!left &&
		!!right &&
		left.left === right.left &&
		left.top === right.top &&
		left.width === right.width &&
		left.height === right.height
	);
}

export function DashboardGrid({
	onImportFile,
	isRaw,
	isScreenshots,
	screenshotEntries,
	screenshotLoading,
	screenshotError,
	refreshScreenshots,
	deleteScreenshot,
	openScreenshot,
	rawPreview,
	setRawPreview,
	rawLoading,
	rawError,
	refreshRaw,
	error,
	section,
	visible,
	busy,
	selecting,
	toggleSelected,
	onRenameProject,
	folders,
	save,
	assignFolder,
	selected,
	openEntry,
	query,
	hasActiveFilters,
	setQuery,
	run,
	onEditRecording,
}: Pick<
	DashboardProps & DashboardModel,
	| "onImportFile"
	| "isRaw"
	| "isScreenshots"
	| "screenshotEntries"
	| "screenshotLoading"
	| "screenshotError"
	| "refreshScreenshots"
	| "deleteScreenshot"
	| "openScreenshot"
	| "rawPreview"
	| "setRawPreview"
	| "rawLoading"
	| "rawError"
	| "refreshRaw"
	| "error"
	| "section"
	| "visible"
	| "busy"
	| "selecting"
	| "toggleSelected"
	| "onRenameProject"
	| "onEditRecording"
	| "folders"
	| "save"
	| "assignFolder"
	| "selected"
	| "openEntry"
	| "query"
	| "hasActiveFilters"
	| "setQuery"
	| "run"
>) {
	const t = useScopedT("editor");
	const tCommon = useScopedT("common");
	// At most one card may own the hover preview, so mounting a new one always
	// follows the previous preview's unmount.
	const [activePreviewPath, setActivePreviewPath] = useState<string | null>(null);
	const previewLayerRef = useRef<HTMLDivElement>(null);
	const previewElementRef = useRef<HTMLElement | null>(null);
	const [preview, setPreview] = useState<PooledPreview | null>(null);
	const handlePreviewReport = useCallback((report: ProjectHoverPreviewReport) => {
		if (!report.data || !report.element) {
			previewElementRef.current = null;
			setPreview((current) =>
				current && current.key === report.key ? { ...current, active: false } : current,
			);
			return;
		}
		previewElementRef.current = report.element;
		setPreview({
			key: report.key,
			data: report.data,
			offset: measurePreviewOffset(report.element, previewLayerRef.current),
			active: true,
		});
	}, []);
	const finishPreview = useCallback(() => {
		setPreview((current) =>
			current && current.active ? { ...current, active: false } : current,
		);
	}, []);
	// The host is positioned over the hovered thumbnail, so a window resize while
	// a preview is showing has to re-measure it.
	useEffect(() => {
		const reposition = () => {
			const element = previewElementRef.current;
			if (!element) return;
			const offset = measurePreviewOffset(element, previewLayerRef.current);
			setPreview((current) => {
				if (!current || sameOffset(current.offset, offset)) return current;
				return { ...current, offset };
			});
		};
		window.addEventListener("resize", reposition);
		return () => window.removeEventListener("resize", reposition);
	}, []);
	return (
		<>
			<main className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-7 pb-10 lg:px-10">
				{error && (
					<p role="alert" className="mb-4 text-sm text-danger">
						{error}
					</p>
				)}
				{section === "settings" ? (
					<DashboardSettings onImportFile={onImportFile} />
				) : isScreenshots ? (
					<ScreenshotGrid
						entries={screenshotEntries}
						loading={screenshotLoading}
						error={screenshotError}
						busy={busy}
						run={run}
						query={query}
						setQuery={setQuery}
						refresh={refreshScreenshots}
						onOpen={openScreenshot}
						onDelete={deleteScreenshot}
					/>
				) : visible.length ? (
					<div ref={previewLayerRef} className="relative">
						<ul
							aria-label={
								isRaw
									? t("dashboard.rawFiles", "Raw files")
									: t("dashboard.yourProjects", "Your projects")
							}
							className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-x-7 gap-y-10 lg:gap-x-9"
						>
							{visible.map((entry) => (
								<ProjectCard
									key={entry.path}
									{...{
										entry,
										busy,
										selecting,
										selected,
										toggleSelected,
										openEntry,
										run,
										onRenameProject,
										folders,
										save,
										assignFolder,
										previewActive:
											activePreviewPath === entry.path && !selecting && !busy,
										onPreviewHover: (active: boolean) =>
											setActivePreviewPath((current) =>
												active
													? entry.path
													: current === entry.path
														? null
														: current,
											),
										onPreviewReport: handlePreviewReport,
									}}
								/>
							))}
						</ul>
						{preview?.offset && (
							// The single host reused by every card. It unmounts only with
							// the grid itself (section change, filter that empties the
							// list), never when the pointer moves between cards.
							<div
								className="pointer-events-none absolute z-10 overflow-hidden rounded-xl"
								style={preview.offset}
							>
								<ProjectHoverPreview
									data={preview.data}
									active={preview.active}
									onFinish={finishPreview}
								/>
							</div>
						)}
					</div>
				) : (
					<div className="flex h-64 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
						{!isRaw && !hasActiveFilters ? (
							<span aria-hidden="true" className="text-4xl">
								🦗
							</span>
						) : (
							<ImageSquare weight="fill" className="size-8 opacity-30" />
						)}
						<p>
							{isRaw
								? rawLoading
									? t("dashboard.loadingRecordings", "Loading recordings…")
									: rawError ||
										(hasActiveFilters
											? t("dashboard.noMatchingRaw", "No matching raw files")
											: t(
													"dashboard.noRawRecordings",
													"No raw recordings yet",
												))
								: hasActiveFilters
									? t("dashboard.noMatchingProjects", "No matching projects")
									: t("dashboard.emptyState", "It's looking empty in here...")}
						</p>
						{!isRaw && !hasActiveFilters && (
							<RecordNewButton busy={busy} run={run} first className="mt-2" />
						)}
						{isRaw && rawError && (
							<Button onClick={() => void refreshRaw()}>
								{tCommon("actions.retry", "Retry")}
							</Button>
						)}
						{query && (
							<Button variant="ghost" size="sm" onClick={() => setQuery("")}>
								{t("dashboard.clearSearch", "Clear search")}
							</Button>
						)}
					</div>
				)}
				<RawPreview
					entry={rawPreview}
					onClose={() => setRawPreview(null)}
					onEdit={onEditRecording}
				/>
			</main>
		</>
	);
}
