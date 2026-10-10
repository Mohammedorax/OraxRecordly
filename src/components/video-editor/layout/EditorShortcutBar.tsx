import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
 * The shortcut strip.
 *
 * One row in the editing area that controls the on-screen keystroke overlay
 * without opening the settings panel: whether it is burned into the video
 * (`enabled`), how many lines it shows, and its look. The row itself can be
 * hidden — the user asked for a strip they can remove or restyle — and the
 * choice is remembered, with a small chip left behind to bring it back.
 */
const SHORTCUT_BAR_HIDDEN_KEY = "recordly.editor.shortcutBarHidden";

/** Width the strip's preview is measured against, so it matches the editor. */
const PREVIEW_REFERENCE_WIDTH = 1280;

/** A representative combination for the preview, not a real keystroke. */
const PREVIEW_KEYS = ["Ctrl", "S"];

const STYLE_LABEL_KEYS: Record<KeycastStyle, { key: string; fallback: string }> = {
	pill: { key: "shortcutBar.stylePill", fallback: "Capsule" },
	bar: { key: "shortcutBar.styleBar", fallback: "Bar" },
	minimal: { key: "shortcutBar.styleMinimal", fallback: "Text only" },
};

export function EditorShortcutBar({
	settings,
	onChange,
	isMac,
}: {
	settings: KeycastSettings;
	onChange: (settings: KeycastSettings) => void;
	isMac: boolean;
}) {
	const t = useScopedT("editor");
	const [hidden, setHidden] = useState(() => Boolean(loadAppSetting(SHORTCUT_BAR_HIDDEN_KEY)));

	useEffect(() => {
		saveAppSetting(SHORTCUT_BAR_HIDDEN_KEY, hidden);
	}, [hidden]);

	if (hidden) {
		return (
			<div className="flex items-center gap-2 px-3 py-1.5">
				<Button
					variant="ghost"
					size="sm"
					className="h-7 px-2 text-muted-foreground text-xs"
					onClick={() => setHidden(false)}
				>
					{t("shortcutBar.show", "Show the shortcut bar")}
				</Button>
			</div>
		);
	}

	const cycleStyle = () => {
		const index = KEYCAST_STYLES.indexOf(settings.style);
		const next = KEYCAST_STYLES[(index + 1) % KEYCAST_STYLES.length];
		onChange({ ...settings, style: next });
	};

	return (
		<div className="flex flex-wrap items-center gap-3 border-separator border-b px-3 py-1.5">
			<span className="text-muted-foreground text-xs">
				{t("shortcutBar.title", "Shortcuts on screen")}
			</span>

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
				style={{ transform: "scale(0.34)", transformOrigin: "left center" }}
			/>

			<div className="ms-auto flex flex-wrap items-center gap-3">
				<Switch
					checked={settings.enabled}
					onCheckedChange={(enabled) => onChange({ ...settings, enabled })}
				>
					{t("shortcutBar.onVideo", "Burn into the video")}
				</Switch>

				<Button
					variant={settings.lines === 2 ? "secondary" : "ghost"}
					size="sm"
					className="h-7 px-2 text-xs"
					onClick={() => onChange({ ...settings, lines: settings.lines === 2 ? 1 : 2 })}
				>
					{settings.lines === 2
						? t("shortcutBar.twoLines", "Two lines")
						: t("shortcutBar.oneLine", "One line")}
				</Button>

				<Button
					variant="ghost"
					size="sm"
					className="h-7 px-2 text-xs"
					onClick={cycleStyle}
					title={t("shortcutBar.styleHint", "Change the shape of the shortcut display")}
				>
					{t("shortcutBar.styleLabel", "Look")}:{" "}
					{t(
						STYLE_LABEL_KEYS[settings.style].key,
						STYLE_LABEL_KEYS[settings.style].fallback,
					)}
				</Button>

				<Button
					variant="ghost"
					size="sm"
					className="h-7 px-2 text-muted-foreground text-xs"
					onClick={() => setHidden(true)}
					title={t("shortcutBar.hide", "Hide this row")}
				>
					{t("shortcutBar.hideShort", "Hide")}
				</Button>
			</div>
		</div>
	);
}
