import { MagnifyingGlass, UploadSimple } from "@/components/ui/icons";
import { type CSSProperties } from "react";
import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";
import { useScopedT } from "@/contexts/I18nContext";

import type { DashboardProps } from "./types";

import type { DashboardModel } from "./useDashboardModel";

export function DashboardToolbar({
	onImportFile,
	isRaw,
	isScreenshots,
	query,
	setQuery,
	run,
	busy,
}: Pick<
	DashboardProps & DashboardModel,
	"onImportFile" | "query" | "setQuery" | "run" | "busy" | "isRaw" | "isScreenshots"
>) {
	const t = useScopedT("editor");
	return (
		<>
			<header
				className="flex h-24 shrink-0 items-center gap-5 px-7 pt-5 lg:px-10"
				style={{ WebkitAppRegion: "drag" } as CSSProperties}
			>
				<div
					className="relative min-w-0 flex-1"
					style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
				>
					<MagnifyingGlass className="pointer-events-none absolute start-3.5 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground/60" />
					<Input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						aria-label={
							isRaw
								? t("dashboard.searchRawFiles", "Search raw files")
								: isScreenshots
									? t("dashboard.searchScreenshots", "Search screenshots")
									: t("dashboard.searchProjects", "Search projects")
						}
						placeholder={
							isRaw
								? t("dashboard.searchRawFilesPlaceholder", "Search raw files…")
								: isScreenshots
									? t(
											"dashboard.searchScreenshotsPlaceholder",
											"Search screenshots…",
										)
									: t("dashboard.searchProjectsPlaceholder", "Search projects…")
						}
						className="h-11 w-full border-0 bg-default/30 ps-10 shadow-none"
					/>
				</div>
				<div style={{ WebkitAppRegion: "no-drag" } as CSSProperties}>
					<Button
						variant="secondary"
						disabled={busy}
						onClick={() => void run(onImportFile)}
						className="h-10 shrink-0 gap-2 text-[13px]"
					>
						<UploadSimple className="size-4" />
						{t("dashboard.import", "Import")}
					</Button>
				</div>
			</header>
		</>
	);
}
