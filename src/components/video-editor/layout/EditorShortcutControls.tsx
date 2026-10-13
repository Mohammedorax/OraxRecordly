import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Keyboard, Palette } from "@/components/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useScopedT } from "@/contexts/I18nContext";
import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";
import {
	KEYCAST_STYLES,
	type KeycastSettings,
	type KeycastStyle,
} from "@/lib/keycast/keycastModel";
import { KeycastKeyCaps } from "../keycast/KeycastBadge";

/**
 * Shortcut controls for the editor's bottom bar.
 *
 * They live inside the playback bar rather than in a row of their own, so the
 * editing area keeps its height. Everything the on-screen keystrokes need is one
 * popover away: burn in or not, one line or two, the shape, and the accent
 * colour. The control group itself can be removed from the bar and is
 * remembered; the full set stays available in the settings panel.
 */
const SHORTCUT_CONTROLS_HIDDEN_KEY = "recordly.editor.shortcutBarHidden";

/** Width the preview is measured against so it matches the editor surface. */
const PREVIEW_REFERENCE_WIDTH = 1280;
const PREVIEW_KEYS = ["Ctrl", "S"];

const STYLE_LABEL_KEYS: Record<KeycastStyle, { key: string; fallback: string }> = {
	pill: { key: "shortcutBar.stylePill", fallback: "Capsule" },
	bar: { key: "shortcutBar.styleBar", fallback: "Bar" },
	minimal: { key: "shortcutBar.styleMinimal", fallback: "Text only" },
};

export function EditorShortcutControls({
	settings,
	onChange,
	isMac,
}: {
	settings: KeycastSettings;
	onChange: (settings: KeycastSettings) => void;
	isMac: boolean;
}) {
	const t = useScopedT("editor");
	const [hidden, setHidden] = useState(() =>
		Boolean(loadAppSetting(SHORTCUT_CONTROLS_HIDDEN_KEY)),
	);

	useEffect(() => {
		saveAppSetting(SHORTCUT_CONTROLS_HIDDEN_KEY, hidden);
	}, [hidden]);

	if (hidden) {
		return (
			<Button
				variant="ghost"
				size="icon"
				className="h-9 w-9 opacity-60"
				title={t("shortcutBar.show", "Show the shortcut controls")}
				onClick={() => setHidden(false)}
			>
				<Keyboard className="h-4 w-4" />
			</Button>
		);
	}

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className={`h-9 w-9 ${settings.enabled ? "bg-foreground/10 text-foreground" : ""}`}
					title={t("shortcutBar.title", "Shortcuts on screen")}
					aria-label={t("shortcutBar.title", "Shortcuts on screen")}
				>
					<Keyboard className="h-4 w-4" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80 p-3">
				<div className="flex flex-col gap-3">
					<div className="flex items-center justify-between gap-2">
						<span className="text-xs font-medium">
							{t("shortcutBar.title", "Shortcuts on screen")}
						</span>
						<Button
							variant="ghost"
							size="sm"
							className="h-6 px-2 text-[11px] text-muted-foreground"
							onClick={() => setHidden(true)}
							title={t("shortcutBar.hide", "Remove from this bar")}
						>
							{t("shortcutBar.hideShort", "Remove")}
						</Button>
					</div>

					<div className="flex items-center justify-center rounded-md bg-foreground/5 py-2">
						<KeycastKeyCaps
							keys={PREVIEW_KEYS}
							settings={settings}
							isMac={isMac}
							containerWidth={PREVIEW_REFERENCE_WIDTH}
							historyLabels={
								settings.lines === 2
									? [
											t("shortcutBar.previewHistory", "Ctrl + C"),
											t("shortcutBar.previewHistoryOlder", "Ctrl + V"),
										]
									: []
							}
							style={{ transform: "scale(0.5)", transformOrigin: "center" }}
						/>
					</div>

					<Switch
						checked={settings.enabled}
						onCheckedChange={(enabled) => onChange({ ...settings, enabled })}
					>
						{t("shortcutBar.onVideo", "Burn into the video")}
					</Switch>

					<div className="flex items-center gap-2">
						<span className="text-xs text-muted-foreground">
							{t("shortcutBar.linesLabel", "Lines")}
						</span>
						<Button
							variant={settings.lines === 1 ? "secondary" : "ghost"}
							size="sm"
							className="h-7 px-2 text-xs"
							onClick={() => onChange({ ...settings, lines: 1 })}
						>
							{t("shortcutBar.oneLine", "One line")}
						</Button>
						<Button
							variant={settings.lines === 2 ? "secondary" : "ghost"}
							size="sm"
							className="h-7 px-2 text-xs"
							onClick={() => onChange({ ...settings, lines: 2 })}
						>
							{t("shortcutBar.twoLines", "Two lines")}
						</Button>
					</div>

					<div className="flex flex-col gap-1.5">
						<span className="text-xs text-muted-foreground">
							{t("shortcutBar.styleLabel", "Look")}
						</span>
						<div className="flex items-center gap-2">
							{KEYCAST_STYLES.map((style) => (
								<Button
									key={style}
									variant={settings.style === style ? "secondary" : "ghost"}
									size="sm"
									className="h-7 flex-1 px-2 text-xs"
									onClick={() => onChange({ ...settings, style })}
								>
									{t(
										STYLE_LABEL_KEYS[style].key,
										STYLE_LABEL_KEYS[style].fallback,
									)}
								</Button>
							))}
						</div>
					</div>

					<div className="flex items-center gap-2">
						<Palette className="h-4 w-4 text-muted-foreground" />
						<Button
							variant={settings.accentColor === null ? "secondary" : "ghost"}
							size="sm"
							className="h-7 px-2 text-xs"
							onClick={() => onChange({ ...settings, accentColor: null })}
						>
							{t("shortcutBar.accentDefault", "Default")}
						</Button>
						{["#2563eb", "#16a34a", "#f59e0b", "#ef4444", "#a855f7"].map((color) => (
							<button
								key={color}
								type="button"
								aria-label={t("shortcutBar.accentPreset", "Accent {{color}}", {
									color,
								})}
								onClick={() => onChange({ ...settings, accentColor: color })}
								className={`size-5 rounded-full border ${
									settings.accentColor === color
										? "border-foreground"
										: "border-separator"
								}`}
								style={{ background: color }}
							/>
						))}
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
