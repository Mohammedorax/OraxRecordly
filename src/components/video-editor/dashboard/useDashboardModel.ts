import { useRawLibrary } from "./useRawLibrary";
import { useScreenshotLibrary } from "./useScreenshotLibrary";
import { useMemo, useState } from "react";
import { toast } from "@/components/ui/toast";
import { useScopedT } from "@/contexts/I18nContext";
import type { ProjectLibraryEntry } from "../ProjectBrowserDialog";
import type { DashboardProps } from "./types";
import { useDashboardMetadata } from "./useDashboardMetadata";
import { useProjectFolders } from "./useProjectFolders";
export function useDashboardModel({
	entries,
	onOpenChange,
	onOpenProject,
	onRenameProject,
	onDeleteProjects,
	open,
}: DashboardProps) {
	const t = useScopedT("editor");
	const { metadata, update } = useDashboardMetadata();
	const [selecting, setSelecting] = useState(false);
	const [selected, setSelected] = useState<string[]>([]);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const toggleSelected = (path: string) =>
		setSelected((prev) =>
			prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path],
		);
	const { folders, save } = useProjectFolders();
	const assignFolder = (path: string, id: string) =>
		save(
			folders.map((f) => ({
				...f,
				paths:
					f.id === id
						? f.paths.includes(path)
							? f.paths.filter((p) => p !== path)
							: [...f.paths, path]
						: id === "none"
							? f.paths.filter((p) => p !== path)
							: f.paths,
			})),
		);
	const [query, setQuery] = useState("");
	const [period, setPeriod] = useState("all");
	const [sort, setSort] = useState("recent");
	const [section, changeSection] = useState("projects");
	const [library, setLibrary] = useState("projects");
	const raw = useRawLibrary(open && library === "raw");
	const screenshots = useScreenshotLibrary(open && library === "screenshots");
	const [rawPreview, setRawPreview] = useState<ProjectLibraryEntry | null>(null);
	const isRaw = library === "raw";
	const isScreenshots = library === "screenshots";
	const setSection = (next: string) => {
		if (next === "projects" || next === "raw" || next === "screenshots") setLibrary(next);
		changeSection(next);
		setQuery("");
		setSelecting(false);
		setSelected([]);
	};
	const libraryEntries = isRaw ? raw.entries : entries;
	const [busy, setBusy] = useState(false);
	const visible = useMemo(
		() =>
			libraryEntries
				.filter((entry) => {
					const cutoff =
						period === "week"
							? Date.now() - 7 * 86400000
							: period === "month"
								? Date.now() - 30 * 86400000
								: 0;
					const folder = folders.find((f) => f.id === section);
					return (
						entry.updatedAt >= cutoff &&
						entry.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
						(!folder || folder.paths.includes(entry.path))
					);
				})
				.sort((a, b) =>
					sort === "name"
						? a.name.localeCompare(b.name)
						: sort === "created"
							? (b.createdAt ?? b.updatedAt) - (a.createdAt ?? a.updatedAt)
							: b.updatedAt - a.updatedAt,
				),
		[libraryEntries, query, period, sort, folders, section],
	);
	const screenshotEntries = useMemo(
		() =>
			screenshots.entries.filter((entry) =>
				entry.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
			),
		[screenshots.entries, query],
	);
	const openScreenshot = async (path: string) => {
		const result = await window.electronAPI.openImageEditor(path);
		if (!result.success)
			throw Error(
				result.error || t("dashboard.openImageEditorFailed", "Could not open image editor"),
			);
	};
	const run = async (action: () => Promise<void>) => {
		if (busy) return;
		setBusy(true);
		try {
			await action();
		} catch (e) {
			toast.error(
				e instanceof Error
					? e.message
					: t("dashboard.actionFailed", "Could not complete action"),
			);
		} finally {
			setBusy(false);
		}
	};
	const openEntry = (entry: ProjectLibraryEntry) =>
		entry.rawSource
			? setRawPreview(entry)
			: entry.isCurrent
				? onOpenChange(false)
				: void run(async () => {
						await onOpenProject(entry.path);
					});
	const navClass = (active: boolean) =>
		`h-10 w-full justify-start gap-3 px-3 text-[13px] ${active ? "bg-default/50 font-medium" : "text-muted-foreground"}`;

	return {
		isRaw,
		isScreenshots,
		screenshotEntries,
		screenshotLoading: screenshots.loading,
		screenshotError: screenshots.error,
		refreshScreenshots: screenshots.refresh,
		deleteScreenshot: screenshots.remove,
		openScreenshot,
		rawPreview,
		setRawPreview,
		rawLoading: raw.loading,
		rawError: raw.error,
		refreshRaw: raw.refresh,
		onRenameProject: isRaw ? raw.rename : onRenameProject,
		onDeleteProjects: isRaw ? raw.remove : onDeleteProjects,
		metadata,
		update,
		selecting,
		setSelecting,
		selected,
		setSelected,
		confirmDelete,
		setConfirmDelete,
		toggleSelected,
		assignFolder,
		query,
		hasActiveFilters:
			Boolean(query.trim()) || period !== "all" || folders.some((f) => f.id === section),
		setQuery,
		period,
		setPeriod,
		sort,
		setSort,
		section,
		setSection,
		busy,
		folders,
		save,
		visible,
		run,
		openEntry,
		navClass,
	};
}
export type DashboardModel = ReturnType<typeof useDashboardModel>;
