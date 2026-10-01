import { useEffect, useRef, useState } from "react";
import { FilmStrip } from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";
import type { RecordingLibraryEntry } from "@/types/recordingLibrary";

export function RecordingThumbnail({ entry }: { entry: RecordingLibraryEntry }) {
	const t = useScopedT("editor");
	const host = useRef<HTMLSpanElement>(null);
	const [src, setSrc] = useState<string>();
	const [failed, setFailed] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: changed file metadata invalidates the cached still.
	useEffect(() => {
		let active = true;
		setSrc(undefined);
		setFailed(false);
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				observer.disconnect();
				void window.electronAPI
					.getRecordingThumbnail(entry.path)
					.then((result) => {
						if (!active) return;
						if (result.success) setSrc(result.value);
						else setFailed(true);
					})
					.catch(() => {
						if (active) setFailed(true);
					});
			},
			{ rootMargin: "80px" },
		);
		if (host.current) observer.observe(host.current);
		return () => {
			active = false;
			observer.disconnect();
		};
	}, [entry.path, entry.createdAt, entry.bytes]);
	return (
		<span
			ref={host}
			className="flex h-9 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-default text-muted-foreground"
		>
			{src ? (
				<img
					src={src}
					alt={t("library.previewOf", "Preview of {{name}}", { name: entry.name })}
					className="size-full object-cover"
					draggable={false}
					onError={() => {
						setSrc(undefined);
						setFailed(true);
					}}
				/>
			) : failed ? (
				<FilmStrip
					className="size-5"
					aria-label={t("library.previewUnavailable", "Preview unavailable")}
				/>
			) : (
				<span
					className="size-full animate-pulse bg-default"
					aria-label={t("library.loadingPreview", "Loading preview image")}
				/>
			)}
		</span>
	);
}
