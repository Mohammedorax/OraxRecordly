import { Dropdown } from "@heroui/react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, DotsThree, FolderSimple, Plus } from "@/components/ui/icons";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import { formatLocaleDate } from "@/utils/localeFormatUtils";
import type { ProjectLibraryEntry } from "../ProjectBrowserDialog";
import { ProjectFolderChips } from "./ProjectFolderChips";
import { type ProjectHoverPreviewReport, ProjectThumbnail } from "./ProjectThumbnail";
import { RawThumbnail } from "./RawRecordings";
import type { DashboardProps } from "./types";
import type { DashboardModel } from "./useDashboardModel";

type Props = Pick<
	DashboardProps & DashboardModel,
	| "busy"
	| "selecting"
	| "selected"
	| "toggleSelected"
	| "openEntry"
	| "run"
	| "onRenameProject"
	| "onEditRecording"
	| "folders"
	| "save"
	| "assignFolder"
> & {
	entry: ProjectLibraryEntry;
	previewActive: boolean;
	onPreviewHover: (active: boolean) => void;
	onPreviewReport: (report: ProjectHoverPreviewReport) => void;
};
export function ProjectCard({
	entry,
	busy,
	selecting,
	selected,
	toggleSelected,
	openEntry,
	run,
	onRenameProject,
	onEditRecording,
	folders,
	save,
	assignFolder,
	previewActive,
	onPreviewHover,
	onPreviewReport,
}: Props) {
	const t = useScopedT("editor");
	const tCommon = useScopedT("common");
	const { locale } = useI18n();
	const [editing, setEditing] = useState(false);
	const renaming = useRef(false);
	const [name, setName] = useState(entry.name);
	const assignedFolders = folders.filter((folder) => folder.paths.includes(entry.path));
	const folder = assignedFolders[0];
	const rename = () => {
		if (renaming.current) return;
		renaming.current = true;
		void run(async () => {
			if (!name.trim() || name.trim() === entry.name) {
				setEditing(false);
				return;
			}
			const target = await onRenameProject(entry.path, name.trim());
			save(
				folders.map((folder) => ({
					...folder,
					paths: folder.paths.map((path) => (path === entry.path ? target : path)),
				})),
			);
			setEditing(false);
		}).finally(() => {
			renaming.current = false;
		});
	};
	return (
		<li className="group min-w-0">
			<Button
				variant="ghost"
				disabled={busy}
				aria-label={entry.name}
				onPointerEnter={(event) => {
					if (event.pointerType === "mouse") onPreviewHover(true);
				}}
				onPointerLeave={() => onPreviewHover(false)}
				onFocus={() => onPreviewHover(true)}
				onBlur={() => onPreviewHover(false)}
				onClick={() => (selecting ? toggleSelected(entry.path) : openEntry(entry))}
				// Double-click takes raw footage straight into the editor; clicking
				// once only previews it, which left users unsure how to start editing.
				onDoubleClick={() => {
					if (entry.rawSource && onEditRecording) {
						void onEditRecording(entry.path);
					}
				}}
				aria-pressed={selecting ? selected.includes(entry.path) : undefined}
				className="relative block h-auto w-full min-w-0 rounded-xl p-0"
			>
				{entry.rawSource ? (
					<RawThumbnail entry={entry.rawSource} active={previewActive} />
				) : (
					<ProjectThumbnail
						key={`${entry.thumbnailPath}-${entry.updatedAt}`}
						revision={entry.updatedAt}
						path={entry.thumbnailPath}
						projectPath={entry.path}
						previewActive={previewActive}
						onPreviewChange={onPreviewReport}
					/>
				)}
				{selecting && (
					<span
						className={`absolute end-2 top-2 flex size-5 items-center justify-center rounded-md ${selected.includes(entry.path) ? "bg-accent text-white" : "bg-background/90"}`}
					>
						{selected.includes(entry.path) && <Check className="size-3.5" />}
					</span>
				)}
			</Button>
			<div className="relative flex items-start justify-between gap-4 pt-5">
				<div data-project-caption className="h-12 min-w-0 flex-1">
					{editing ? (
						<form
							onSubmit={(event) => {
								event.preventDefault();
								rename();
							}}
						>
							<input
								autoFocus
								aria-label={
									entry.rawSource
										? t("dashboard.rawFileName", "Raw file name")
										: t("dashboard.projectName", "Project name")
								}
								className="inline-project-name h-5 w-full pe-8 text-[12px] font-medium"
								value={name}
								disabled={busy}
								maxLength={120}
								onChange={(event) => setName(event.target.value)}
								onBlur={rename}
								onKeyDown={(event) => {
									if (event.key === "Escape") {
										event.preventDefault();
										setEditing(false);
									}
								}}
							/>
						</form>
					) : (
						<p
							title={entry.name}
							className="truncate pe-8 text-[12px] font-medium leading-5"
						>
							{entry.name}
						</p>
					)}
					<div className="mt-1 flex h-6 min-w-0 items-center gap-2">
						<p className="shrink-0 text-[11px] text-muted-foreground">
							{formatLocaleDate(entry.updatedAt, locale, {
								month: "short",
								day: "numeric",
							})}
						</p>
						<ProjectFolderChips
							folders={assignedFolders}
							name={entry.name}
							onRemove={(id) => assignFolder(entry.path, id)}
						/>
						<Dropdown>
							<Button
								variant="ghost"
								size="sm"
								aria-label={t("dashboard.addFolderTo", "Add folder to {{name}}", {
									name: entry.name,
								})}
								className="h-6 min-w-0 shrink-0 gap-1.5 rounded-full px-2.5 text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100"
							>
								<Plus className="size-3" />
								{t("dashboard.addFolder", "Add folder")}
							</Button>
							<Dropdown.Popover>
								<Dropdown.Menu
									aria-label={t(
										"dashboard.assignProjectFolder",
										"Assign project folder",
									)}
								>
									{folders.map((item) => (
										<Dropdown.Item
											key={item.id}
											id={item.id}
											textValue={item.name}
											onAction={() => assignFolder(entry.path, item.id)}
										>
											<FolderSimple
												weight="fill"
												style={{ color: item.color }}
											/>
											{item.name}
											{item.paths.includes(entry.path) && (
												<Check className="size-3" />
											)}
										</Dropdown.Item>
									))}
									{folder && (
										<Dropdown.Item
											id="remove"
											onAction={() => assignFolder(entry.path, "none")}
										>
											{t(
												"dashboard.removeFromAllFolders",
												"Remove from all folders",
											)}
										</Dropdown.Item>
									)}
									{!folders.length && (
										<Dropdown.Item id="empty" isDisabled>
											{t(
												"dashboard.createFolderInSidebar",
												"Create a folder in the sidebar",
											)}
										</Dropdown.Item>
									)}
								</Dropdown.Menu>
							</Dropdown.Popover>
						</Dropdown>
					</div>
				</div>
				<Dropdown>
					<Button
						variant="ghost"
						size="icon"
						aria-label={t("dashboard.optionsFor", "Options for {{name}}", {
							name: entry.name,
						})}
						className="absolute end-0 top-5 size-6 min-w-6 text-muted-foreground"
					>
						<DotsThree weight="bold" className="size-5" />
					</Button>
					<Dropdown.Popover>
						<Dropdown.Menu
							aria-label={t("dashboard.projectOptions", "Project options")}
						>
							{entry.rawSource && onEditRecording && (
								<Dropdown.Item
									id="edit"
									onAction={() => void onEditRecording(entry.path)}
								>
									{t("dashboard.editRecording", "Edit in editor")}
								</Dropdown.Item>
							)}
							<Dropdown.Item id="open" onAction={() => openEntry(entry)}>
								{entry.rawSource
									? t("dashboard.previewFile", "Preview file")
									: t("dashboard.openProject", "Open project")}
							</Dropdown.Item>
							<Dropdown.Item
								id="rename"
								onAction={() => {
									setName(entry.name);
									setEditing(true);
								}}
							>
								{tCommon("actions.rename", "Rename")}
							</Dropdown.Item>
							<Dropdown.Item
								aria-label={
									entry.rawSource
										? t(
												"dashboard.showInFolderFor",
												"Show {{name}} in folder",
												{ name: entry.name },
											)
										: undefined
								}
								id="reveal"
								onAction={() =>
									void run(async () => {
										await window.electronAPI.revealInFolder(entry.path);
									})
								}
							>
								{t("dashboard.showInFolder", "Show in folder")}
							</Dropdown.Item>
						</Dropdown.Menu>
					</Dropdown.Popover>
				</Dropdown>
			</div>
		</li>
	);
}
