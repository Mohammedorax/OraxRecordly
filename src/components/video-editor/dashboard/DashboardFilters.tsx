import type { DashboardProps } from "./types";
import { Dropdown } from "@heroui/react";
import { CaretDown, Trash } from "@/components/ui/icons";

import { Button } from "@/components/ui/button";
import { useScopedT } from "@/contexts/I18nContext";

import type { DashboardModel } from "./useDashboardModel";

export function DashboardFilters({
	isRaw,
	period,
	setPeriod,
	selecting,
	setSelecting,
	selected,
	setSelected,
	sort,
	setSort,
	visible,
	busy,
	setConfirmDelete,
}: Pick<
	DashboardModel & DashboardProps,
	| "isRaw"
	| "period"
	| "setPeriod"
	| "selecting"
	| "setSelecting"
	| "selected"
	| "setSelected"
	| "sort"
	| "setSort"
	| "visible"
	| "busy"
	| "setConfirmDelete"
>) {
	const t = useScopedT("editor");
	const tCommon = useScopedT("common");
	return (
		<>
			<div className="flex items-center gap-3 px-7 pb-7 lg:px-10">
				<div className="flex gap-2" aria-label={t("dashboard.timeFilters", "Time filters")}>
					{[
						["all", t("dashboard.periodAll", "All")],
						["week", t("dashboard.periodWeek", "Last 7 days")],
						["month", t("dashboard.periodMonth", "Last 30 days")],
					].map(([id, label]) => (
						<Button
							key={id}
							variant="ghost"
							size="sm"
							aria-pressed={period === id}
							onClick={() => setPeriod(id)}
							className={`h-7 rounded-lg px-3 text-xs ${period === id ? "bg-default/60 text-foreground" : "text-muted-foreground"}`}
						>
							{label}
						</Button>
					))}
					<Button
						variant="ghost"
						size="icon"
						className="size-7 min-w-7 text-danger"
						aria-label={
							isRaw
								? t("dashboard.selectRawToRemove", "Select raw files to remove")
								: t("dashboard.selectProjectsToDelete", "Select projects to delete")
						}
						aria-pressed={selecting}
						onClick={() => {
							setSelecting(!selecting);
							setSelected([]);
						}}
					>
						<Trash weight="fill" className="size-4" />
					</Button>
				</div>
				<div className="ms-auto">
					<Dropdown>
						<Button
							variant="ghost"
							size="sm"
							aria-label={
								isRaw
									? t("dashboard.sortRawFiles", "Sort raw files")
									: t("dashboard.sortProjects", "Sort projects")
							}
							className="h-7 gap-2 text-xs text-muted-foreground"
						>
							{sort === "recent"
								? isRaw
									? t("dashboard.sortLastCreated", "Last created")
									: t("dashboard.sortLastEdited", "Last edited")
								: sort === "created"
									? t("dashboard.sortLastCreated", "Last created")
									: t("dashboard.sortName", "Name")}
							<CaretDown className="size-3" />
						</Button>
						<Dropdown.Popover>
							<Dropdown.Menu
								aria-label={
									isRaw
										? t("dashboard.sortRawFiles", "Sort raw files")
										: t("dashboard.sortProjects", "Sort projects")
								}
							>
								{!isRaw && (
									<Dropdown.Item id="recent" onAction={() => setSort("recent")}>
										{t("dashboard.sortLastEdited", "Last edited")}
									</Dropdown.Item>
								)}
								<Dropdown.Item id="created" onAction={() => setSort("created")}>
									{t("dashboard.sortLastCreated", "Last created")}
								</Dropdown.Item>
								<Dropdown.Item id="name" onAction={() => setSort("name")}>
									{t("dashboard.sortName", "Name")}
								</Dropdown.Item>
							</Dropdown.Menu>
						</Dropdown.Popover>
					</Dropdown>
				</div>
			</div>
			{selecting && (
				<div className="flex items-center gap-3 px-7 pb-5 text-xs lg:px-10">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setSelected(visible.map((e) => e.path))}
					>
						{t("dashboard.selectAll", "Select all")}
					</Button>
					<span>
						{t("dashboard.selectedCount", "{{count}} selected", {
							count: selected.length,
						})}
					</span>
					<Button
						variant="destructive"
						size="sm"
						disabled={!selected.length || busy}
						onClick={() => setConfirmDelete(true)}
					>
						{isRaw
							? t("dashboard.remove", "Remove")
							: tCommon("actions.delete", "Delete")}
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => {
							setSelecting(false);
							setSelected([]);
						}}
					>
						{tCommon("actions.cancel", "Cancel")}
					</Button>
				</div>
			)}
		</>
	);
}
