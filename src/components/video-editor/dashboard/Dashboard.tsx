import { Card, Modal } from "@heroui/react";
import { useScopedT } from "@/contexts/I18nContext";
import { DashboardAnnouncements } from "./DashboardAnnouncements";
import { DashboardDialogs } from "./DashboardDialogs";
import { DashboardFilters } from "./DashboardFilters";
import { DashboardGrid } from "./DashboardGrid";
import { DashboardSidebar } from "./DashboardSidebar";
import { DashboardToolbar } from "./DashboardToolbar";
import type { DashboardProps } from "./types";
import { useDashboardModel } from "./useDashboardModel";
export function Dashboard(props: DashboardProps) {
	const t = useScopedT("editor");
	const model = useDashboardModel(props);
	const view = { ...props, ...model };
	return (
		<>
			<Modal isOpen={props.open} onOpenChange={props.onOpenChange}>
				<Modal.Backdrop>
					<Modal.Container size="full">
						<Modal.Dialog
							aria-label={t("dashboard.projectsDashboard", "Projects dashboard")}
							className="dashboard-surface dashboard-shell flex h-full flex-row gap-0 rounded-none bg-background p-0 text-foreground"
						>
							<DashboardSidebar {...view} />
							<Card className="my-3 me-3 flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden rounded-2xl bg-background p-0 shadow-sm">
								{model.section !== "settings" && (
									<>
										<DashboardAnnouncements />
										<DashboardToolbar {...view} />
										{model.section !== "screenshots" && (
											<DashboardFilters {...view} />
										)}
									</>
								)}
								<DashboardGrid {...view} />
							</Card>
						</Modal.Dialog>
					</Modal.Container>
				</Modal.Backdrop>
			</Modal>
			<DashboardDialogs {...view} />
		</>
	);
}
