import { Label } from "@heroui/react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import { ChoiceGroup, ChoiceItem } from "@/components/ui/choice-group";
import { FolderOpenIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { useScopedT } from "@/contexts/I18nContext";
import {
	buildScreenshotFileName,
	DEFAULT_SCREENSHOT_FILE_NAME_TEMPLATE,
	SCREENSHOT_FILE_NAME_TEMPLATE_TOKENS,
} from "@/utils/screenshotFileName";
import { SettingsRow } from "./SettingsRow";
import { SliderControl } from "./SliderControl";

/** Preset delays offered for `captureDelayMs`, matching the main-process store. */
const CAPTURE_DELAY_OPTIONS = [
	{ value: 0, seconds: 0 },
	{ value: 3000, seconds: 3 },
	{ value: 5000, seconds: 5 },
] as const;

/** How long the "Saved" affordance stays visible after a successful write. */
const SAVED_AFFORDANCE_MS = 1600;
/** JPEG quality sliders would otherwise fire one write per pointer movement. */
const QUALITY_SAVE_DEBOUNCE_MS = 400;

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "Dead"]);

/**
 * Builds an Electron accelerator from a key press, or null when the press is
 * not a usable combination (a bare letter, a modifier, …).
 */
function acceleratorFromKeyEvent(event: ReactKeyboardEvent<HTMLInputElement>): string | null {
	const { key } = event;
	if (MODIFIER_KEYS.has(key)) {
		return null;
	}

	const modifiers: string[] = [];
	if (event.ctrlKey || event.metaKey) {
		modifiers.push("CommandOrControl");
	}
	if (event.altKey) {
		modifiers.push("Alt");
	}
	if (event.shiftKey) {
		modifiers.push("Shift");
	}

	const isFunctionKey = /^F\d{1,2}$/.test(key);
	if (modifiers.length === 0 && !isFunctionKey) {
		return null;
	}

	let base = key;
	if (key === " ") {
		base = "Space";
	} else if (key.length === 1) {
		base = key.toUpperCase();
	} else if (key.startsWith("Arrow")) {
		base = key.slice("Arrow".length);
	}

	return [...modifiers, base].join("+");
}

/**
 * Editor settings section for the standalone screenshot system. It reads and
 * writes the main-process screenshot preferences (`userData/screenshot-settings.json`)
 * through the preload bridge, so there is a single source of truth.
 */
export function ScreenshotSettingsSection() {
	const t = useScopedT("settings");
	const [preferences, setPreferences] = useState<RendererScreenshotPreferences | null>(null);
	const [shortcutDraft, setShortcutDraft] = useState("");
	const [templateDraft, setTemplateDraft] = useState(DEFAULT_SCREENSHOT_FILE_NAME_TEMPLATE);
	const [shortcutError, setShortcutError] = useState(false);
	const [folder, setFolder] = useState<string | null>(null);
	const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
	const [openingFolder, setOpeningFolder] = useState(false);
	const [choosingFolder, setChoosingFolder] = useState(false);
	const savedTimerRef = useRef<number | null>(null);
	const qualityTimerRef = useRef<number | null>(null);
	const qualityRef = useRef<number>(92);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const [preferenceResult, folderResult] = await Promise.all([
					window.electronAPI.getScreenshotPreferences(),
					window.electronAPI.getScreenshotsFolder(),
				]);
				if (cancelled) {
					return;
				}

				if (preferenceResult.success && preferenceResult.preferences) {
					setPreferences(preferenceResult.preferences);
					setShortcutDraft(preferenceResult.preferences.globalShortcut ?? "");
					setTemplateDraft(preferenceResult.preferences.fileNameTemplate);
					qualityRef.current = preferenceResult.preferences.jpegQuality;
				}
				if (folderResult.success && folderResult.path) {
					setFolder(folderResult.path);
				}
			} catch (error) {
				console.error("Failed to load the screenshot preferences:", error);
			}
		})();

		return () => {
			cancelled = true;
			if (savedTimerRef.current !== null) {
				window.clearTimeout(savedTimerRef.current);
			}
			if (qualityTimerRef.current !== null) {
				window.clearTimeout(qualityTimerRef.current);
			}
		};
	}, []);

	const showSaved = useCallback(() => {
		setStatus("saved");
		if (savedTimerRef.current !== null) {
			window.clearTimeout(savedTimerRef.current);
		}
		savedTimerRef.current = window.setTimeout(() => {
			savedTimerRef.current = null;
			setStatus("idle");
		}, SAVED_AFFORDANCE_MS);
	}, []);

	const save = useCallback(
		async (patch: Parameters<typeof window.electronAPI.setScreenshotPreferences>[0]) => {
			setStatus("saving");
			try {
				const result = await window.electronAPI.setScreenshotPreferences(patch);
				if (!result.success || !result.preferences) {
					throw new Error(result.error ?? "Failed to save screenshot preferences");
				}

				setPreferences(result.preferences);
				setShortcutDraft(result.preferences.globalShortcut ?? "");
				setShortcutError(result.shortcutRegistered === false);
				setTemplateDraft(result.preferences.fileNameTemplate);
				qualityRef.current = result.preferences.jpegQuality;
				showSaved();
				return result;
			} catch (error) {
				setStatus("idle");
				setShortcutError(false);
				toast.error(
					`${t("screenshots.saveFailed", "Could not save the screenshot settings")} ${String(error)}`,
				);
				return null;
			}
		},
		[showSaved, t],
	);

	const commitShortcut = useCallback(() => {
		const accelerator = shortcutDraft.trim();
		void save({ globalShortcut: accelerator.length > 0 ? accelerator : null });
	}, [save, shortcutDraft]);

	/**
	 * The store clamps an empty/whitespace-only template back to the default, and
	 * `save` re-syncs the draft from the persisted value, so an empty field simply
	 * snaps back to `Screenshot {date} {time}`.
	 */
	const commitTemplate = useCallback(() => {
		void save({ fileNameTemplate: templateDraft });
	}, [save, templateDraft]);

	const refreshFolder = useCallback(async () => {
		try {
			const result = await window.electronAPI.getScreenshotsFolder();
			if (result.success && result.path) {
				setFolder(result.path);
			}
		} catch (error) {
			console.error("Failed to refresh the screenshots folder:", error);
		}
	}, []);

	const chooseScreenshotsFolder = async () => {
		setChoosingFolder(true);
		try {
			const result = await window.electronAPI.chooseScreenshotsFolder();
			if (result.canceled) {
				return;
			}
			if (!result.success || !result.path) {
				throw new Error(result.error ?? "Failed to change the screenshots folder");
			}

			if (result.preferences) {
				setPreferences(result.preferences);
				setShortcutDraft(result.preferences.globalShortcut ?? "");
				setTemplateDraft(result.preferences.fileNameTemplate);
				qualityRef.current = result.preferences.jpegQuality;
			}
			setFolder(result.path);
			showSaved();
		} catch (error) {
			toast.error(
				`${t("screenshots.chooseFolderFailed", "Could not change the screenshots folder")} ${String(error)}`,
			);
		} finally {
			setChoosingFolder(false);
		}
	};

	const resetScreenshotsFolder = async () => {
		const result = await save({ folder: null });
		if (result) {
			await refreshFolder();
		}
	};

	const handleShortcutKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter" || event.key === "Tab") {
			return;
		}

		const accelerator = acceleratorFromKeyEvent(event);
		if (!accelerator) {
			return;
		}

		event.preventDefault();
		setShortcutError(false);
		setShortcutDraft(accelerator);
		void save({ globalShortcut: accelerator });
	};

	const handleQualityChange = (value: number) => {
		if (!preferences) {
			return;
		}

		// Optimistically show the new value, then persist once the drag settles.
		setPreferences({ ...preferences, jpegQuality: value });
		qualityRef.current = value;
		if (qualityTimerRef.current !== null) {
			window.clearTimeout(qualityTimerRef.current);
		}
		qualityTimerRef.current = window.setTimeout(() => {
			qualityTimerRef.current = null;
			void save({ jpegQuality: qualityRef.current });
		}, QUALITY_SAVE_DEBOUNCE_MS);
	};

	const openScreenshotsFolder = async () => {
		setOpeningFolder(true);
		try {
			const result = await window.electronAPI.openScreenshotsFolder();
			if (!result.success) {
				throw new Error(result.error ?? "Failed to open the screenshots folder");
			}
			if (result.path) {
				setFolder(result.path);
			}
		} catch (error) {
			toast.error(
				`${t("screenshots.openFolderFailed", "Could not open the screenshots folder")} ${String(error)}`,
			);
		} finally {
			setOpeningFolder(false);
		}
	};

	const statusLabel =
		status === "saving"
			? t("screenshots.saving", "Saving…")
			: status === "saved"
				? t("screenshots.saved", "Saved")
				: null;

	// Rendered by the same helper the main process writes with, so the preview is
	// always the real, sanitized name.
	const templatePreview = buildScreenshotFileName(
		new Date(),
		templateDraft.trim().length > 0 ? templateDraft : DEFAULT_SCREENSHOT_FILE_NAME_TEMPLATE,
		{
			counter: 1,
			appName: t("screenshots.fileNamePreviewApp", "App"),
			extension: preferences?.format === "jpeg" ? "jpg" : "png",
		},
	);

	return (
		<section className="flex flex-col gap-4">
			<div className="flex items-center justify-between gap-3">
				<Label className="text-[13px]">{t("screenshots.title", "Screenshots")}</Label>
				<span
					aria-live="polite"
					className="text-xs text-muted-foreground"
					data-screenshot-save-status={status}
				>
					{statusLabel}
				</span>
			</div>

			<SettingsRow title={t("screenshots.format", "Format")} stacked>
				<ChoiceGroup
					type="single"
					aria-label={t("screenshots.format", "Format")}
					value={preferences?.format ?? "png"}
					onValueChange={(value) => {
						if (value === "png" || value === "jpeg") {
							void save({ format: value });
						}
					}}
					fullWidth
					size="sm"
				>
					<ChoiceItem value="png" className="flex-1">
						{t("screenshots.formatPng", "PNG (lossless)")}
					</ChoiceItem>
					<ChoiceItem value="jpeg" className="flex-1">
						{t("screenshots.formatJpeg", "JPEG")}
					</ChoiceItem>
				</ChoiceGroup>
			</SettingsRow>

			{preferences?.format === "jpeg" && (
				<SliderControl
					label={t("screenshots.jpegQuality", "JPEG quality")}
					value={preferences.jpegQuality}
					min={1}
					max={100}
					step={1}
					onChange={handleQualityChange}
					formatValue={(value) => `${Math.round(value)}%`}
				/>
			)}

			<SettingsRow
				title={t("screenshots.fileNameTemplate", "File name template")}
				description={t(
					"screenshots.fileNameTemplateDescription",
					"Tokens: {{tokens}}. Unknown text is kept as-is.",
					{ tokens: SCREENSHOT_FILE_NAME_TEMPLATE_TOKENS.join(", ") },
				)}
				stacked
			>
				<div className="flex w-full flex-col gap-2">
					<Input
						aria-label={t("screenshots.fileNameTemplate", "File name template")}
						// The template is a technical, LTR token string
						// ("Screenshot {date} {time}"); the same rule the image
						// editor's file name follows. Without it the RTL base
						// direction reorders any template that starts with a token
						// (e.g. "{date}-{time}").
						dir="ltr"
						value={templateDraft}
						placeholder={t(
							"screenshots.fileNameTemplatePlaceholder",
							"Screenshot {date} {time}",
						)}
						className="w-full px-2 py-1 font-mono text-xs"
						onChange={(event) => setTemplateDraft(event.target.value)}
						onBlur={commitTemplate}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.currentTarget.blur();
							}
						}}
					/>
					<p
						className="truncate text-xs text-muted-foreground"
						data-screenshot-template-preview={templatePreview}
					>
						{t("screenshots.fileNamePreview", "Preview:")} {/*
						 * <bdi> isolates the generated name: it keeps its own
						 * direction (LTR for the default template) instead of
						 * being reordered against the RTL label around it.
						 */}
						<bdi>{templatePreview}</bdi>
					</p>
				</div>
			</SettingsRow>

			<SettingsRow
				title={t("screenshots.openEditor", "Open the editor after capture")}
				description={t(
					"screenshots.openEditorDescription",
					"Open the image editor with the saved capture so you can annotate it right away.",
				)}
			>
				<Switch
					aria-label={t("screenshots.openEditor", "Open the editor after capture")}
					checked={preferences?.openEditorAfterCapture ?? true}
					disabled={!preferences}
					onCheckedChange={(checked) => void save({ openEditorAfterCapture: checked })}
				/>
			</SettingsRow>

			<SettingsRow
				title={t("screenshots.copyToClipboard", "Copy to clipboard after capture")}
				description={t(
					"screenshots.copyToClipboardDescription",
					"Put every capture on the system clipboard in addition to saving it.",
				)}
			>
				<Switch
					aria-label={t("screenshots.copyToClipboard", "Copy to clipboard after capture")}
					checked={preferences?.copyToClipboard ?? false}
					disabled={!preferences}
					onCheckedChange={(checked) => void save({ copyToClipboard: checked })}
				/>
			</SettingsRow>

			<SettingsRow
				title={t("screenshots.captureDelay", "Capture delay")}
				description={t(
					"screenshots.captureDelayDescription",
					"Show a countdown before the capture starts, so you can arrange the screen first.",
				)}
				stacked
			>
				<ChoiceGroup
					type="single"
					aria-label={t("screenshots.captureDelay", "Capture delay")}
					value={String(preferences?.captureDelayMs ?? 0)}
					onValueChange={(value) => void save({ captureDelayMs: Number(value) })}
					fullWidth
					size="sm"
				>
					{CAPTURE_DELAY_OPTIONS.map((option) => (
						<ChoiceItem
							key={option.value}
							value={String(option.value)}
							className="flex-1"
						>
							{option.seconds === 0
								? t("screenshots.delayNone", "None")
								: t("screenshots.delaySeconds", "{{seconds}}s", {
										seconds: option.seconds,
									})}
						</ChoiceItem>
					))}
				</ChoiceGroup>
			</SettingsRow>

			<SettingsRow
				title={t("screenshots.globalShortcut", "Global shortcut")}
				description={t(
					"screenshots.globalShortcutDescription",
					"Works from any application. Clear the field to disable it.",
				)}
				stacked
			>
				<div className="flex w-full items-center gap-2">
					<Input
						aria-label={t("screenshots.globalShortcut", "Global shortcut")}
						// An Electron accelerator ("CommandOrControl+Shift+A") is a
						// technical LTR token; keeping the field LTR stops the RTL
						// base direction from reordering combinations that mix
						// letters and digits.
						dir="ltr"
						value={shortcutDraft}
						placeholder={t("screenshots.shortcutPlaceholder", "Press a shortcut…")}
						className="w-full px-2 py-1 font-mono text-xs"
						onChange={(event) => {
							setShortcutError(false);
							setShortcutDraft(event.target.value);
						}}
						onKeyDown={handleShortcutKeyDown}
						onBlur={commitShortcut}
						onFocus={(event) => event.currentTarget.select()}
					/>
					<Button
						type="button"
						variant="secondary"
						size="sm"
						className="h-8 shrink-0"
						onClick={() => {
							setShortcutDraft("");
							setShortcutError(false);
							void save({ globalShortcut: null });
						}}
					>
						{t("screenshots.shortcutDisable", "Disable")}
					</Button>
				</div>
				{shortcutError ? (
					<p role="alert" className="text-xs text-danger">
						{t(
							"screenshots.shortcutUnavailable",
							"Another application already uses this shortcut. Try a different combination.",
						)}
					</p>
				) : (
					<p className="text-xs text-muted-foreground">
						{shortcutDraft.trim().length > 0
							? t("screenshots.shortcutActive", "Active from any application.")
							: t("screenshots.shortcutDisabled", "The global shortcut is disabled.")}
					</p>
				)}
			</SettingsRow>

			<SettingsRow
				title={t("screenshots.folder", "Screenshot folder")}
				stacked
				description={
					<>
						<span className="block break-all">
							{folder ?? t("screenshots.folderLoading", "Resolving the folder…")}
						</span>
						<span className="block">
							{preferences?.folder
								? t("screenshots.folderCustom", "Custom folder")
								: t("screenshots.folderDefault", "Default folder")}
						</span>
					</>
				}
			>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						type="button"
						variant="secondary"
						size="sm"
						className="h-8 gap-2"
						disabled={choosingFolder}
						onClick={() => void chooseScreenshotsFolder()}
					>
						{t("screenshots.folderChange", "Change…")}
					</Button>
					<Button
						type="button"
						variant="secondary"
						size="sm"
						className="h-8"
						disabled={!preferences?.folder || status === "saving"}
						onClick={() => void resetScreenshotsFolder()}
					>
						{t("screenshots.folderReset", "Reset to default")}
					</Button>
					<Button
						type="button"
						variant="secondary"
						size="sm"
						className="h-8 gap-2"
						disabled={openingFolder}
						onClick={() => void openScreenshotsFolder()}
					>
						<FolderOpenIcon aria-hidden className="size-4" />
						{t("screenshots.openFolder", "Open folder")}
					</Button>
				</div>
			</SettingsRow>
		</section>
	);
}
