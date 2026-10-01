import { Dropdown } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DotsThree, FolderOpenIcon, ImageSquare } from "@/components/ui/icons";
import { toast } from "@/components/ui/toast";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import type { ScreenshotLibraryEntry } from "@/types/screenshotLibrary";
import { formatLocaleDate } from "@/utils/localeFormatUtils";

type RunAction = (action: () => Promise<void>) => Promise<void>;

export function ScreenshotThumbnail({ entry }: { entry: ScreenshotLibraryEntry }) {
	const host = useRef<HTMLDivElement>(null);
	const [visible, setVisible] = useState(false);
	useEffect(() => {
		// Match RawThumbnail: only load pixels once the card scrolls near the viewport.
		if (typeof IntersectionObserver === "undefined") {
			setVisible(true);
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				observer.disconnect();
				setVisible(true);
			},
			{ rootMargin: "80px" },
		);
		if (host.current) observer.observe(host.current);
		return () => observer.disconnect();
	}, []);
	return (
		<div
			ref={host}
			className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl bg-default/60"
		>
			{visible && entry.url ? (
				<img src={entry.url} alt={entry.name} className="h-full w-full object-cover" />
			) : (
				<ImageSquare weight="fill" className="size-8 text-muted-foreground/40" />
			)}
		</div>
	);
}

function ScreenshotCard({
	entry,
	busy,
	run,
	onOpen,
	onDelete,
}: {
	entry: ScreenshotLibraryEntry;
	busy: boolean;
	run: RunAction;
	onOpen: (path: string) => Promise<void>;
	onDelete: (path: string) => Promise<unknown>;
}) {
	const t = useScopedT("editor");
	const tCommon = useScopedT("common");
	const { locale } = useI18n();
	const open = () => void run(() => onOpen(entry.path));
	return (
		<li className="group min-w-0">
			<Button
				variant="ghost"
				disabled={busy}
				aria-label={entry.name}
				onClick={open}
				className="relative block h-auto w-full min-w-0 rounded-xl p-0"
			>
				<ScreenshotThumbnail entry={entry} />
			</Button>
			<div className="relative flex items-start justify-between gap-4 pt-5">
				<div data-screenshot-caption className="h-12 min-w-0 flex-1">
					<p
						title={entry.name}
						className="truncate pe-8 text-[12px] font-medium leading-5"
					>
						{/*
						 * <bdi> isolates the generated name: a file whose name
						 * starts with a token (the template can be reordered, e.g.
						 * "{date} {time}") would otherwise have its parts reordered
						 * against the page's RTL base direction.
						 */}
						<bdi>{entry.name}</bdi>
					</p>
					<p className="mt-1 text-[11px] text-muted-foreground">
						{formatLocaleDate(entry.modifiedMs, locale, {
							month: "short",
							day: "numeric",
						})}
					</p>
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
							aria-label={t("dashboard.screenshotOptions", "Screenshot options")}
						>
							<Dropdown.Item id="open" onAction={open}>
								{t("dashboard.openInImageEditor", "Open in image editor")}
							</Dropdown.Item>
							<Dropdown.Item
								id="reveal"
								onAction={() =>
									void run(async () => {
										await window.electronAPI.revealInFolder(entry.path);
									})
								}
							>
								{t("dashboard.showInFolder", "Show in folder")}
							</Dropdown.Item>
							<Dropdown.Item
								id="copy"
								onAction={() =>
									void run(async () => {
										await navigator.clipboard.writeText(entry.path);
										toast.success(t("dashboard.pathCopied", "Path copied"));
									})
								}
							>
								{t("dashboard.copyPath", "Copy path")}
							</Dropdown.Item>
							<Dropdown.Item
								id="delete"
								onAction={() =>
									void run(async () => {
										await onDelete(entry.path);
										toast.success(
											t(
												"dashboard.screenshotDeleted",
												"Screenshot moved to Trash",
											),
										);
									})
								}
							>
								{tCommon("actions.delete", "Delete")}
							</Dropdown.Item>
						</Dropdown.Menu>
					</Dropdown.Popover>
				</Dropdown>
			</div>
		</li>
	);
}

export function ScreenshotGrid({
	entries,
	loading,
	error,
	busy,
	run,
	query,
	setQuery,
	refresh,
	onOpen,
	onDelete,
}: {
	entries: ScreenshotLibraryEntry[];
	loading: boolean;
	error: string | null;
	busy: boolean;
	run: RunAction;
	query: string;
	setQuery: (query: string) => void;
	refresh: () => Promise<void>;
	onOpen: (path: string) => Promise<void>;
	onDelete: (path: string) => Promise<unknown>;
}) {
	const t = useScopedT("editor");
	const tCommon = useScopedT("common");
	const openFolder = () =>
		void run(async () => {
			const result = await window.electronAPI.openScreenshotsFolder();
			if (!result.success) {
				throw Error(
					result.error ||
						t(
							"dashboard.openScreenshotsFolderFailed",
							"Could not open the screenshots folder",
						),
				);
			}
		});
	if (!entries.length) {
		return (
			<div className="flex h-64 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
				<ImageSquare weight="fill" className="size-8 opacity-30" />
				<p>
					{loading
						? t("dashboard.loadingScreenshots", "Loading screenshots…")
						: error ||
							(query.trim()
								? t("dashboard.noMatchingScreenshots", "No matching screenshots")
								: t("dashboard.noScreenshots", "No screenshots yet"))}
				</p>
				{error && (
					<Button onClick={() => void refresh()}>
						{tCommon("actions.retry", "Retry")}
					</Button>
				)}
				{query && (
					<Button variant="ghost" size="sm" onClick={() => setQuery("")}>
						{t("dashboard.clearSearch", "Clear search")}
					</Button>
				)}
				{!loading && (
					<Button variant="ghost" size="sm" className="gap-2" onClick={openFolder}>
						<FolderOpenIcon aria-hidden className="size-4" />
						{t("dashboard.openScreenshotsFolder", "Open screenshots folder")}
					</Button>
				)}
			</div>
		);
	}
	return (
		<>
			{/* Toolbar: the folder action stays reachable even when the grid is long. */}
			<div className="mb-4 flex items-center justify-end">
				<Button
					variant="ghost"
					size="sm"
					className="gap-2 text-muted-foreground"
					disabled={busy}
					onClick={openFolder}
				>
					<FolderOpenIcon aria-hidden className="size-4" />
					{t("dashboard.openScreenshotsFolder", "Open screenshots folder")}
				</Button>
			</div>
			<ul
				aria-label={t("dashboard.screenshots", "Screenshots")}
				className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-x-7 gap-y-10 lg:gap-x-9"
			>
				{entries.map((entry) => (
					<ScreenshotCard
						key={entry.path}
						entry={entry}
						busy={busy}
						run={run}
						onOpen={onOpen}
						onDelete={onDelete}
					/>
				))}
			</ul>
		</>
	);
}
