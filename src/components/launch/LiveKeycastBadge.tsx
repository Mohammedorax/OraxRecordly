import { useEffect, useState } from "react";
import { KeycastKeyCaps } from "@/components/video-editor/keycast/KeycastBadge";
import {
	KEYCAST_FADE_MS,
	type KeycastKeystroke,
	type KeycastSettings,
	normalizeKeycastSettings,
} from "@/lib/keycast/keycastModel";
import { loadKeycastSettings } from "@/lib/keycast/keycastSettings";

/**
 * Live key badge inside the recording HUD.
 *
 * Keystrokes are pushed from the main-process input hook (`keycast-keystroke`)
 * while a recording is running, so the presenter sees exactly what will be
 * burned into the video at export. The HUD box is wide and mostly empty above
 * the bar, so the badge is anchored to the top center of that box rather than to
 * a screen corner: the export overlay is the one that obeys the configured
 * position, and the HUD is only a confirmation surface.
 *
 * The HUD is hidden from screen capture on Windows/macOS while recording, so
 * this live badge never doubles the burned-in one. (Linux has no HUD capture
 * protection, which is a pre-existing HUD limitation on that platform.)
 *
 * Windows measure the HUD box width, which is a fixed 860 DIP
 * (`HUD_WIDTH_DIP` in `electron/hudOverlayBounds.ts`).
 */
const HUD_BOX_WIDTH = 860;

export function LiveKeycastBadge() {
	const [settings, setSettings] = useState<KeycastSettings>(() => loadKeycastSettings());
	const [stroke, setStroke] = useState<KeycastKeystroke | null>(null);
	const [isMac, setIsMac] = useState(false);

	useEffect(() => {
		let mounted = true;
		void (async () => {
			try {
				const platform = await window.electronAPI?.getPlatform?.();
				if (mounted && platform) {
					setIsMac(platform === "darwin");
				}
			} catch {
				// Platform detection is cosmetic here; keep the non-mac glyphs.
			}
		})();

		return () => {
			mounted = false;
		};
	}, []);

	useEffect(() => {
		// The HUD is the one window that is always alive, so it owns arming the
		// main-process capture flag: without this push the persisted opt-in would
		// only take effect after the editor window had been opened once.
		const persisted = loadKeycastSettings();
		setSettings(persisted);
		void window.electronAPI?.setKeycastSettings?.(persisted);

		const stopSettings = window.electronAPI?.onKeycastSettingsChanged?.((next) => {
			setSettings(normalizeKeycastSettings(next));
		});
		const stopStrokes = window.electronAPI?.onKeycastKeystroke?.((next) => {
			setStroke(next ?? null);
		});

		return () => {
			stopSettings?.();
			stopStrokes?.();
		};
	}, []);

	useEffect(() => {
		if (!stroke) {
			return;
		}

		const timeout = window.setTimeout(
			() => setStroke(null),
			Math.max(0, settings.holdMs) + KEYCAST_FADE_MS,
		);
		return () => window.clearTimeout(timeout);
	}, [stroke, settings.holdMs]);

	if (!settings.enabled || !stroke) {
		return null;
	}

	return (
		<div
			className="pointer-events-none fixed left-1/2 z-50 -translate-x-1/2"
			style={{ top: 16 }}
			aria-hidden="true"
		>
			<KeycastKeyCaps
				keys={stroke.keys}
				settings={settings}
				isMac={isMac}
				containerWidth={HUD_BOX_WIDTH}
			/>
		</div>
	);
}
