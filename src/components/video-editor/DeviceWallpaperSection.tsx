import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowClockwise, CaretDown, FolderOpen, ImageSquare } from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";
import { getWallpaperThumbnailUrl } from "@/lib/assetPath";
import {
	type DeviceWallpaperImage,
	listDeviceWallpaperImages,
	pickDeviceWallpaperImage,
	withSelectedDeviceWallpaper,
} from "@/lib/systemWallpapers";
import { cn } from "@/lib/utils";
import { isDeviceImagePath } from "@/lib/wallpapers";
import { WallpaperGrid } from "./WallpaperGrid";

/**
 * Collapsible gallery of images that already exist on the user's machine
 * (current desktop wallpaper, Windows theme caches, system wallpaper folders,
 * Pictures, plus any image chosen with Browse…).
 *
 * The scan is lazy: it only runs the first time the section is opened, so
 * opening the editor never touches the disk.
 */
export function DeviceWallpaperSection({
	selected,
	onSelect,
	isSelected,
}: {
	selected: string;
	onSelect: (value: string) => void;
	isSelected: (value: string, previewUrl?: string) => boolean;
}) {
	const t = useScopedT("settings");
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [loaded, setLoaded] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [images, setImages] = useState<DeviceWallpaperImage[]>([]);
	const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});

	const loadThumbnails = useCallback(async (list: DeviceWallpaperImage[]) => {
		const entries = await Promise.all(
			list.map(async (image) => {
				try {
					const thumbnailUrl = await getWallpaperThumbnailUrl(image.path);
					return [image.path, thumbnailUrl || image.url] as const;
				} catch {
					return [image.path, image.url] as const;
				}
			}),
		);

		setPreviewUrls((previous) => ({ ...previous, ...Object.fromEntries(entries) }));
	}, []);

	const runScan = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await listDeviceWallpaperImages();
			if (result.error) {
				setError(result.error);
			}
			setImages(result.images);
			setLoaded(true);
		} finally {
			setLoading(false);
		}
	}, []);

	// Keep a selected device image visible even when the scan did not return it
	// (e.g. a project reopened after the file moved outside the scanned folders).
	const visibleImages = useMemo(
		() => withSelectedDeviceWallpaper(images, isDeviceImagePath(selected) ? selected : ""),
		[images, selected],
	);

	useEffect(() => {
		if (!open) {
			return;
		}

		const missingThumbnails = visibleImages.filter(
			(image) => previewUrls[image.path] === undefined,
		);
		if (missingThumbnails.length === 0) {
			return;
		}

		void loadThumbnails(missingThumbnails);
	}, [loadThumbnails, open, previewUrls, visibleImages]);

	const handleToggle = () => {
		const nextOpen = !open;
		setOpen(nextOpen);
		if (nextOpen && !loaded && !loading) {
			void runScan();
		}
	};

	const handleBrowse = async () => {
		const result = await pickDeviceWallpaperImage();
		if (result.canceled) {
			return;
		}

		const image = result.image;
		if (!image) {
			setError(result.error ?? "Image picker failed");
			return;
		}

		setError(null);
		setLoaded(true);
		setImages((previous) =>
			previous.some((candidate) => candidate.path === image.path)
				? previous
				: [image, ...previous],
		);
		onSelect(image.path);
	};

	const items = visibleImages.map((image) => ({
		key: `device/${image.path}`,
		value: image.path,
		previewUrl: previewUrls[image.path] ?? image.url ?? "",
		label:
			image.source === "desktop"
				? t("background.deviceImageDesktop", "Current desktop wallpaper")
				: image.name,
	}));

	return (
		<section className="pt-4" data-testid="device-wallpaper-section">
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="flex w-full items-center justify-start gap-2 px-0 text-xs text-muted"
				onClick={handleToggle}
				aria-expanded={open}
			>
				<CaretDown className={cn("size-3 transition-transform", open && "rotate-180")} />
				<ImageSquare className="size-4" />
				<span>{t("background.fromDevice", "From this device")}</span>
			</Button>

			{open && (
				<div className="space-y-2 pt-2">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<p className="text-[11px] text-muted">
							{t(
								"background.fromDeviceDescription",
								"Use any image from your computer as the background.",
							)}
						</p>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							iconSize="sm"
							className="h-auto gap-1.5 p-0 text-xs text-accent"
							onClick={() => {
								void handleBrowse();
							}}
						>
							<FolderOpen />
							{t("background.browseDeviceImage", "Browse…")}
						</Button>
					</div>
					{loading ? (
						<div className="flex items-center gap-2 text-xs text-muted">
							<ArrowClockwise className="size-3.5 animate-spin" />
							{t("background.loadingDeviceImages", "Looking for images…")}
						</div>
					) : (
						<>
							{error && (
								<p role="alert" className="text-xs text-danger">
									{t(
										"background.deviceImagesFailed",
										"Could not load images from this device.",
									)}
								</p>
							)}
							{!error && visibleImages.length === 0 && (
								<p className="text-xs text-muted">
									{t(
										"background.noDeviceImages",
										"No images found on this device.",
									)}
								</p>
							)}
							<WallpaperGrid
								items={items}
								addLabel={t("background.browseDeviceImage", "Browse…")}
								onAdd={() => {
									void handleBrowse();
								}}
								onSelect={onSelect}
								onRemove={() => undefined}
								isSelected={isSelected}
							/>
						</>
					)}
				</div>
			)}
		</section>
	);
}
