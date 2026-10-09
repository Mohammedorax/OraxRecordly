import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useScopedT } from "@/contexts/I18nContext";

import type { DashboardProps } from "./types";

import type { DashboardModel } from "./useDashboardModel";

export function DashboardDialogs({
	isRaw,
	folders,
	busy,
	confirmDelete,
	setConfirmDelete,
	selected,
	run,
	onDeleteProjects,
	save,
	setSelected,
	setSelecting,
}: Pick<
	DashboardProps & DashboardModel,
	| "isRaw"
	| "folders"
	| "busy"
	| "confirmDelete"
	| "setConfirmDelete"
	| "selected"
	| "run"
	| "onDeleteProjects"
	| "save"
	| "setSelected"
	| "setSelecting"
>) {
	const t = useScopedT("editor");
	const tCommon = useScopedT("common");
	const count = selected.length;
	const title = isRaw
		? count === 1
			? t("dashboard.confirmRemoveRaw", "Remove {{count}} raw file?", { count })
			: t("dashboard.confirmRemoveRawPlural", "Remove {{count}} raw files?", { count })
		: count === 1
			? t("dashboard.confirmDeleteProject", "Delete {{count}} project?", { count })
			: t("dashboard.confirmDeleteProjectPlural", "Delete {{count}} projects?", { count });
	const descriptionFallback = isRaw
		? "Remove these files from the library. Original files stay on disk so existing projects keep working."
		: "Project files move to Trash. Source recordings are kept.";
	const description = t(
		isRaw ? "dashboard.removeRawDescription" : "dashboard.deleteProjectDescription",
		descriptionFallback,
	);
	return (
		<>
			<Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
					</DialogHeader>
					<p className="text-sm text-muted-foreground">{description}</p>
					<DialogFooter>
						<Button variant="ghost" onClick={() => setConfirmDelete(false)}>
							{tCommon("actions.cancel", "Cancel")}
						</Button>
						<Button
							variant="destructive"
							disabled={busy}
							onClick={() =>
								void run(async () => {
									const deleted = await onDeleteProjects(selected);
									save(
										folders.map((f) => ({
											...f,
											paths: f.paths.filter((p) => !deleted.includes(p)),
										})),
									);
									setSelected(selected.filter((p) => !deleted.includes(p)));
									setConfirmDelete(false);
									if (deleted.length === selected.length) setSelecting(false);
								})
							}
						>
							{isRaw
								? t("dashboard.removeFromLibrary", "Remove from library")
								: t("dashboard.moveToTrash", "Move to Trash")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
