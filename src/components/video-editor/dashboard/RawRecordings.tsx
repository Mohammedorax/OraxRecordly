import { Modal } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { MusicNotes } from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";
import type { RecordingLibraryEntry } from "@/types/recordingLibrary";
import type { ProjectLibraryEntry } from "../ProjectBrowserDialog";

const isAudio = (name: string) => /\.(wav|m4a|mp3|ogg|flac)$/i.test(name);
export function RawThumbnail({ entry, active }: { entry: RecordingLibraryEntry; active: boolean }) {
	const video = useRef<HTMLVideoElement>(null);
	const host = useRef<HTMLDivElement>(null);
	const [poster, setPoster] = useState<string>();
	useEffect(() => {
		if (isAudio(entry.name)) return;
		let active = true;
		const requestThumbnail = () => {
			if (!active) return;
			void window.electronAPI
				.getRecordingThumbnail(entry.path)
				.then((result) => {
					if (active && result.success) setPoster(result.value);
				})
				.catch(() => undefined);
		};
		// Without an observer, request immediately rather than never.
		if (typeof IntersectionObserver === "undefined") {
			requestThumbnail();
			return () => {
				active = false;
			};
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				observer.disconnect();
				requestThumbnail();
			},
			{ rootMargin: "80px" },
		);
		if (host.current) observer.observe(host.current);
		return () => {
			active = false;
			observer.disconnect();
		};
	}, [entry.path, entry.name]);
	useEffect(() => {
		const element = video.current;
		if (!element) return;
		if (!active || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			element.pause();
			element.currentTime = 0;
			return;
		}
		const timer = window.setTimeout(() => {
			element.currentTime = 0;
			void element.play().catch(() => undefined);
		}, 300);
		const stop = () => {
			if (document.hidden) element.pause();
		};
		document.addEventListener("visibilitychange", stop);
		return () => {
			clearTimeout(timer);
			element.pause();
			document.removeEventListener("visibilitychange", stop);
		};
	}, [active]);
	return (
		<div
			ref={host}
			className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl bg-default/60"
		>
			{isAudio(entry.name) ? (
				<MusicNotes weight="fill" className="size-8 text-muted-foreground/40" />
			) : (
				<video
					ref={video}
					poster={poster}
					src={entry.url}
					muted
					playsInline
					preload="metadata"
					className="h-full w-full object-cover"
					onTimeUpdate={(event) => {
						if (event.currentTarget.currentTime >= 5) event.currentTarget.pause();
					}}
				/>
			)}
		</div>
	);
}
export function RawPreview({
	entry,
	onClose,
	onEdit,
}: {
	entry: ProjectLibraryEntry | null;
	onClose: () => void;
	/** Starts editing the previewed recording instead of only watching it. */
	onEdit?: (path: string) => void;
}) {
	const t = useScopedT("editor");
	const tCommon = useScopedT("common");
	return (
		<Modal
			isOpen={!!entry}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<Modal.Backdrop>
				<Modal.Container size="lg">
					<Modal.Dialog aria-label={t("dashboard.rawFilePreview", "Raw file preview")}>
						<Modal.CloseTrigger />
						<Modal.Header>
							<Modal.Heading>{entry?.name}</Modal.Heading>
						</Modal.Header>
						<Modal.Body>
							{entry?.rawSource &&
								(isAudio(entry.rawSource.name) ? (
									<audio controls src={entry.rawSource.url} className="w-full" />
								) : (
									<video
										controls
										src={entry.rawSource.url}
										className="max-h-[65vh] w-full rounded-xl"
									/>
								))}
						</Modal.Body>
						{/* Watching the file is not the only thing a user wants here, and
						    without an explicit action the editor felt unreachable. */}
						{entry && onEdit && (
							<Modal.Footer className="flex justify-end gap-3">
								<Button variant="ghost" onClick={onClose}>
									{tCommon("actions.close", "Close")}
								</Button>
								<Button
									onClick={() => {
										const path = entry.path;
										onClose();
										onEdit(path);
									}}
								>
									{t("dashboard.editRecording", "Edit in editor")}
								</Button>
							</Modal.Footer>
						)}
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
