import { RecordNewButton } from "./RecordNewButton";
import { SidebarCards } from "./SidebarCards";
import { FolderRow } from "./FolderRow";
import { File, GearSix, House, ImageSquare, Plus } from "@/components/ui/icons";

import { Button } from "@/components/ui/button";
import { useScopedT } from "@/contexts/I18nContext";

import type { DashboardProps } from "./types";

import type { DashboardModel } from "./useDashboardModel";
import { FOLDER_COLORS } from "./useProjectFolders";

export function DashboardSidebar({
	busy,
	run,
	folders,
	save,
	section,
	setSection,
	metadata,
	update,
	navClass,
}: Pick<
	DashboardProps & DashboardModel,
	| "busy"
	| "run"
	| "folders"
	| "save"
	| "section"
	| "setSection"
	| "metadata"
	| "update"
	| "navClass"
>) {
	const t = useScopedT("editor");
	return (
		<>
			<aside
				aria-label={t("dashboard.libraryNavigation", "Library navigation")}
				className="flex w-48 shrink-0 flex-col bg-transparent px-4 pb-5 pt-12 lg:w-56"
			>
				<div className="mb-4 flex h-10 items-center gap-2.5 px-3">
					<img
						src={`${import.meta.env.BASE_URL}app-icons/recordly-64.png`}
						alt=""
						className="size-7 rounded-lg"
					/>
					<span className="text-[15px] font-semibold tracking-tight">Recordly</span>
				</div>
				<RecordNewButton busy={busy} run={run} className="mb-5 w-full" />
				<nav className="space-y-1">
					<Button
						variant="ghost"
						className={navClass(section === "projects")}
						aria-current={section === "projects" ? "page" : undefined}
						onClick={() => setSection("projects")}
					>
						<House weight="fill" className="size-[18px]" />
						{t("dashboard.navHome", "Home")}
					</Button>
					<Button
						variant="ghost"
						className={navClass(section === "raw")}
						aria-current={section === "raw" ? "page" : undefined}
						onClick={() => setSection("raw")}
					>
						<File
							weight={section === "raw" ? "fill" : "regular"}
							className="size-[18px]"
						/>
						{t("dashboard.navRaw", "Raw")}
					</Button>
					<Button
						variant="ghost"
						className={navClass(section === "screenshots")}
						aria-current={section === "screenshots" ? "page" : undefined}
						onClick={() => setSection("screenshots")}
					>
						<ImageSquare
							weight={section === "screenshots" ? "fill" : "regular"}
							className="size-[18px]"
						/>
						{t("dashboard.navScreenshots", "Screenshots")}
					</Button>
				</nav>
				<div className="mb-2 mt-9 flex items-center justify-between ps-3">
					<h2 className="text-[13px] font-semibold tracking-tight text-foreground/80">
						{t("dashboard.foldersHeading", "Folders")}
					</h2>
					<Button
						variant="ghost"
						size="icon"
						className="size-7 min-w-7"
						aria-label={t("dashboard.newFolder", "New folder")}
						onClick={() => {
							let name = t("dashboard.untitledFolder", "Untitled folder"),
								index = 1;
							while (folders.some((folder) => folder.name === name))
								name = t(
									"dashboard.untitledFolderIndexed",
									"Untitled folder {{index}}",
									{ index: index++ },
								);
							save([
								...folders,
								{
									id: crypto.randomUUID(),
									name,
									color: FOLDER_COLORS[0],
									paths: [],
								},
							]);
						}}
					>
						<Plus className="size-3.5" />
					</Button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto space-y-1">
					{folders.map((folder) => (
						<FolderRow
							key={folder.id}
							folder={folder}
							active={section === folder.id}
							onSelect={() => setSection(folder.id)}
							onChange={(next) =>
								save(folders.map((item) => (item.id === next.id ? next : item)))
							}
							onRemove={() => {
								save(folders.filter((item) => item.id !== folder.id));
								if (section === folder.id) setSection("projects");
							}}
							colors={metadata.colors}
							onColors={(colors) => update({ ...metadata, colors })}
						/>
					))}
				</div>
				<div className="space-y-1 pt-6">
					<SidebarCards />
					<Button
						variant="ghost"
						className={navClass(section === "settings")}
						aria-current={section === "settings" ? "page" : undefined}
						onClick={() => setSection("settings")}
					>
						<GearSix
							weight={section === "settings" ? "fill" : "regular"}
							className="size-[18px]"
						/>
						{t("dashboard.navSettings", "Settings")}
					</Button>
				</div>
			</aside>
		</>
	);
}
