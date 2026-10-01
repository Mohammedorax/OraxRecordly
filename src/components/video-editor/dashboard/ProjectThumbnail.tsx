import type { ProjectPreviewData } from "@/types/projectPreview";
import { ImageSquare } from "@/components/ui/icons";
import { useState, useEffect, useRef } from "react";
import { toFileUrl } from "../projectPersistence";

/**
 * Hover-preview source handed to the dashboard, which owns the single pooled
 * preview host. `data: null` reports that this card stopped previewing; `key`
 * lets the dashboard ignore a late report from a card it already moved on from.
 */
export type ProjectHoverPreviewReport = {
	key: string;
	element: HTMLElement | null;
	data: ProjectPreviewData | null;
};

export function ProjectThumbnail({
	path,
	projectPath,
	previewActive = false,
	revision = 0,
	onPreviewChange,
}: {
	path: string | null;
	projectPath?: string;
	previewActive?: boolean;
	revision?: number;
	onPreviewChange?: (report: ProjectHoverPreviewReport) => void;
}) {
	const [failedSource, setFailedSource] = useState<string | null>(null);
	const [preview, setPreview] = useState<ProjectPreviewData | null>(null);
	const host = useRef<HTMLDivElement>(null);
	const key = projectPath ?? "";
	// The dashboard keeps the preview host, so what this card produces is reported
	// upward. The latest reporter is read from a ref because the fetch effect must
	// not restart just because the parent re-rendered with a new callback.
	const reportRef = useRef(onPreviewChange);
	reportRef.current = onPreviewChange;
	useEffect(() => {
		reportRef.current?.({ key, element: host.current, data: preview });
	}, [preview, key]);
	useEffect(() => {
		return () => reportRef.current?.({ key, element: null, data: null });
	}, [key]);
	useEffect(() => {
		if (
			!previewActive ||
			!projectPath ||
			window.matchMedia("(prefers-reduced-motion: reduce)").matches
		)
			return;
		let active = true;
		const timer = window.setTimeout(() => {
			void window.electronAPI
				.getProjectPreview(projectPath)
				.then((result) => {
					if (active && !document.hidden && result.success) setPreview(result.value);
				})
				.catch(() => undefined);
		}, 300);
		const observer = new IntersectionObserver((entries) => {
			if (entries.every((entry) => !entry.isIntersecting)) {
				active = false;
				setPreview(null);
			}
		});
		if (host.current) observer.observe(host.current);
		return () => {
			active = false;
			clearTimeout(timer);
			observer.disconnect();
			setPreview(null);
		};
		// `revision` is intentionally not a dependency: it is only read by the
		// `<img>` source key, and ProjectCard remounts this component (keyed by
		// thumbnail path + updatedAt) whenever the revision changes, which already
		// restarts this effect with fresh state.
	}, [previewActive, projectPath]);
	const sourceKey = `${path}:${revision}`;
	return (
		<div
			ref={host}
			className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl bg-default/60"
		>
			{path && failedSource !== sourceKey ? (
				<img
					src={
						/^(data:|blob:)/.test(path)
							? path
							: `${/^https?:/.test(path) ? path : toFileUrl(path)}?v=${revision}`
					}
					alt=""
					loading="lazy"
					draggable={false}
					onError={() => setFailedSource(sourceKey)}
					className="h-full w-full object-cover"
				/>
			) : (
				<ImageSquare weight="fill" className="size-8 text-muted-foreground/20" />
			)}
		</div>
	);
}
