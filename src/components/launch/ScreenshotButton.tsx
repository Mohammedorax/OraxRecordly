import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import {
	ArrowClockwiseIcon,
	BoundingBox,
	CameraIcon,
	CaretDown,
	Crop,
	MonitorIcon,
} from "@/components/ui/icons";
import { toast } from "@/components/ui/toast";
import { useScopedT } from "@/contexts/I18nContext";
import { Button } from "../ui/button";
import styles from "./LaunchWindow.module.css";
import { useLaunchPopoverCoordinator } from "./popovers/LaunchPopoverCoordinator";
import { HudPopover } from "./popovers/PopoverScaffold";

const POPOVER_ID = "screenshot";

/** Result shape shared by every screenshot channel on the preload bridge. */
interface ScreenshotOutcome {
	success: boolean;
	path?: string;
	width?: number;
	height?: number;
	error?: string;
	fallback?: boolean;
	message?: string;
	canceled?: boolean;
}

/**
 * The screenshot slice of the preload bridge. Declared locally (and optionally)
 * so the full-screen and region channels stay typed while the shared bridge
 * typings are updated in parallel.
 */
interface ScreenshotBridge {
	captureScreenshot: () => Promise<ScreenshotOutcome>;
	captureScreenshotFullScreen?: () => Promise<ScreenshotOutcome>;
	captureScreenshotRegion?: () => Promise<ScreenshotOutcome>;
	getScreenshotPreferences?: () => Promise<{
		success: boolean;
		preferences?: {
			lastCaptureMode?: "fullscreen" | "region" | "source" | null;
			copyToClipboard?: boolean;
		};
	}>;
	readImageFile?: (
		path: string,
	) => Promise<{ success: boolean; dataUrl?: string; error?: string }>;
	writeClipboardImage?: (dataUrl: string) => Promise<{ success: boolean; error?: string }>;
}

type CaptureMode = "full-screen" | "region" | "source";

/** The stored mode vocabulary is slightly flatter than the chooser's. */
type StoredCaptureMode = "fullscreen" | "region" | "source";

const STORED_MODE_TO_CAPTURE_MODE: Record<StoredCaptureMode, CaptureMode> = {
	fullscreen: "full-screen",
	region: "region",
	source: "source",
};

type CaptureFn = () => Promise<ScreenshotOutcome>;

interface CaptureOption {
	mode: CaptureMode;
	icon: ReactNode;
	label: string;
	description: string;
}

interface ScreenshotButtonProps {
	/** External hard-disable; the button never disables itself for a missing source. */
	disabled?: boolean;
	/** True when a recording source is selected, which adds the source capture mode. */
	sourceAvailable?: boolean;
	/** Sizing class for the trigger, so both HUD states keep their own button shape. */
	className?: string;
	iconClassName?: string;
	iconSize?: "default" | "sm" | "lg" | "xl";
	/** Callers that wrap the button in their own tooltip opt out of the native title. */
	showTitle?: boolean;
}

/**
 * Capture-control button shared by the idle and recording HUD states.
 *
 * The button itself repeats the last successful capture mode, so the common
 * "same snip again" flow is a single click. The attached caret opens the full
 * chooser (full screen / selected area / selected source); before the first
 * successful capture the button opens that chooser directly. It owns its
 * in-flight state locally so capturing never re-renders (or resets) the
 * surrounding HUD while a recording is running.
 */
export function ScreenshotButton({
	disabled = false,
	sourceAvailable = false,
	className,
	iconClassName = "size-5",
	iconSize = "lg",
	showTitle = true,
}: ScreenshotButtonProps) {
	const t = useScopedT("launch");
	const { isOpen, requestOpen, requestClose } = useLaunchPopoverCoordinator();
	const [capturing, setCapturing] = useState(false);
	const capturingRef = useRef(false);
	const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const [lastMode, setLastMode] = useState<CaptureMode | null>(null);
	/** When the main process already copied the shot, the toast offers reveal instead. */
	const [autoCopy, setAutoCopy] = useState(false);
	const open = isOpen(POPOVER_ID);
	const label = t("screenshot.capture");

	// Restore the mode the main process saved after the last successful capture.
	useEffect(() => {
		let cancelled = false;
		const bridge = window.electronAPI as unknown as ScreenshotBridge;
		if (typeof bridge.getScreenshotPreferences !== "function") {
			return;
		}

		void bridge
			.getScreenshotPreferences()
			.then((result) => {
				const stored = result?.preferences?.lastCaptureMode;
				if (!cancelled && stored) {
					setLastMode(STORED_MODE_TO_CAPTURE_MODE[stored]);
				}
				if (!cancelled) {
					setAutoCopy(result?.preferences?.copyToClipboard === true);
				}
			})
			.catch(() => {
				// The chooser still works without a remembered mode.
			});

		return () => {
			cancelled = true;
		};
	}, []);

	const options: CaptureOption[] = [
		{
			mode: "full-screen",
			icon: <BoundingBox size={16} />,
			label: t("screenshot.fullScreen"),
			description: t("screenshot.fullScreenDescription"),
		},
		{
			mode: "region",
			icon: <Crop size={16} />,
			label: t("screenshot.region"),
			description: t("screenshot.regionDescription"),
		},
	];

	// Full screen and region work without a source; only the source capture needs
	// one, so the option is dropped instead of disabling the whole chooser.
	if (sourceAvailable) {
		options.push({
			mode: "source",
			icon: <MonitorIcon size={16} />,
			label: t("screenshot.source"),
			description: t("screenshot.sourceDescription"),
		});
	}

	const runCapture = async (mode: CaptureMode) => {
		if (capturingRef.current) {
			return;
		}

		const bridge = window.electronAPI as unknown as ScreenshotBridge;
		const capture: CaptureFn | undefined =
			mode === "full-screen"
				? bridge.captureScreenshotFullScreen
				: mode === "region"
					? bridge.captureScreenshotRegion
					: bridge.captureScreenshot;

		if (typeof capture !== "function") {
			toast.error(t("screenshot.failed"));
			return;
		}

		capturingRef.current = true;
		setCapturing(true);

		try {
			const result = await capture();

			// A cancelled region capture is deliberate; stay silent instead of
			// reporting a failure the user caused on purpose.
			if (result?.canceled) {
				return;
			}

			if (!result?.success) {
				toast.error(
					result?.error
						? `${t("screenshot.failed")} ${result.error}`
						: t("screenshot.failed"),
				);
				return;
			}

			// The main process persists this for the next launch; mirror it locally so
			// the button repeats the new mode immediately.
			setLastMode(mode);

			const savedPath = result.path;
			// When the stored source disappeared the main process captures the
			// primary display instead; say so rather than silently saving a
			// different screen than the user expected.
			const description = result.fallback && result.message ? result.message : savedPath;

			toast.success(t("screenshot.saved"), {
				description,
				action: savedPath ? buildToastAction(savedPath) : undefined,
			});
		} catch (error) {
			toast.error(`${t("screenshot.failed")} ${String(error)}`);
		} finally {
			capturingRef.current = false;
			setCapturing(false);
		}
	};

	/**
	 * The toast has a single action slot. When the main process already put the
	 * shot on the clipboard, "Show in folder" is the useful one; otherwise the
	 * user most likely wants to paste it somewhere, so offer to copy it here.
	 */
	const buildToastAction = (savedPath: string) => {
		if (autoCopy) {
			return {
				label: t("screenshot.showInFolder"),
				onClick: () => {
					void window.electronAPI.revealInFolder(savedPath);
				},
			};
		}

		return {
			label: t("screenshot.copyImage"),
			onClick: () => {
				void copyImageToClipboard(savedPath);
			},
		};
	};

	const copyImageToClipboard = async (savedPath: string) => {
		const bridge = window.electronAPI as unknown as ScreenshotBridge;
		if (
			typeof bridge.writeClipboardImage !== "function" ||
			typeof bridge.readImageFile !== "function"
		) {
			toast.error(t("screenshot.copyFailed"));
			return;
		}

		try {
			const file = await bridge.readImageFile(savedPath);
			if (!file?.success || !file.dataUrl) {
				toast.error(t("screenshot.copyFailed"));
				return;
			}

			const written = await bridge.writeClipboardImage(file.dataUrl);
			if (written?.success) {
				toast.success(t("screenshot.copied"));
				return;
			}
			toast.error(`${t("screenshot.copyFailed")} ${written?.error ?? ""}`.trim());
		} catch (error) {
			toast.error(`${t("screenshot.copyFailed")} ${String(error)}`);
		}
	};

	const handleSelect = (mode: CaptureMode) => {
		requestClose(POPOVER_ID);
		void runCapture(mode);
	};

	const canRepeatLastMode = lastMode !== null && (lastMode !== "source" || sourceAvailable);

	/** Primary click: repeat the last mode, or open the chooser before the first capture. */
	const handlePrimaryClick = () => {
		if (capturingRef.current) {
			return;
		}

		if (!canRepeatLastMode || !lastMode) {
			requestOpen(POPOVER_ID);
			return;
		}

		requestClose(POPOVER_ID);
		void runCapture(lastMode);
	};

	// Roving focus for the option list: the popover's dialog only handles Escape,
	// so arrow keys move between the capture modes here.
	const handleOptionsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
			return;
		}

		event.preventDefault();
		const count = options.length;
		if (count === 0) {
			return;
		}

		const currentIndex = optionRefs.current.findIndex(
			(element) => element === document.activeElement,
		);
		const step = event.key === "ArrowDown" ? 1 : -1;
		const nextIndex = currentIndex === -1 ? 0 : (currentIndex + step + count) % count;
		optionRefs.current[nextIndex]?.focus();
	};

	const captureIcon = capturing ? (
		<ArrowClockwiseIcon aria-hidden className={`${iconClassName} ${styles.finalizingSpin}`} />
	) : (
		<CameraIcon className={iconClassName} />
	);

	return (
		<div className={`${styles.electronNoDrag} flex items-center`}>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				iconSize={iconSize}
				className={className}
				disabled={disabled || capturing}
				aria-label={label}
				aria-haspopup={canRepeatLastMode ? undefined : "menu"}
				aria-expanded={canRepeatLastMode ? undefined : open}
				title={showTitle ? label : undefined}
				onClick={handlePrimaryClick}
			>
				{captureIcon}
			</Button>

			<HudPopover
				open={open}
				onOpenChange={(nextOpen) => {
					if (nextOpen) {
						requestOpen(POPOVER_ID);
						return;
					}
					requestClose(POPOVER_ID);
				}}
				trigger={
					<Button
						type="button"
						variant="ghost"
						size="icon"
						iconSize="sm"
						className={`-ms-1 size-6 min-w-6 ${styles.electronNoDrag}`}
						disabled={disabled || capturing}
						aria-label={t("screenshot.moreModes", "Choose a capture mode")}
						aria-haspopup="menu"
						aria-expanded={open}
						title={t("screenshot.moreModes", "Choose a capture mode")}
					>
						<CaretDown aria-hidden className="size-3" />
					</Button>
				}
				align="center"
			>
				<div className={styles.ddLabel}>{t("screenshot.chooserTitle")}</div>
				<div className="flex flex-col gap-0.5" onKeyDown={handleOptionsKeyDown}>
					{options.map((option, index) => (
						<Button
							key={option.mode}
							ref={(element) => {
								optionRefs.current[index] = element;
							}}
							type="button"
							variant="ghost"
							className="h-auto w-full justify-start gap-3 py-2"
							onClick={() => handleSelect(option.mode)}
						>
							<span className="shrink-0 text-foreground">{option.icon}</span>
							<span className="flex min-w-0 flex-col items-start gap-0.5 text-start">
								<span className="truncate text-sm">{option.label}</span>
								<span className="truncate text-xs text-muted-foreground">
									{option.description}
								</span>
							</span>
						</Button>
					))}
				</div>
			</HudPopover>
		</div>
	);
}
