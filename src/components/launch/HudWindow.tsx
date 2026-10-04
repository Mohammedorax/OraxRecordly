import { Toaster } from "../ui/toast";
import { LaunchWindow } from "./LaunchWindow";
import { LiveKeycastBadge } from "./LiveKeycastBadge";

export default function HudWindow() {
	return (
		<>
			<LaunchWindow />
			{/*
			 * Live keystroke badge: the presenter sees the same key caps that the
			 * export burns into the video. The HUD is excluded from capture while
			 * recording on Windows/macOS, so this never doubles the final overlay.
			 */}
			<LiveKeycastBadge />
			{/*
			 * The HUD is a compact bottom-anchored window, so toasts are placed
			 * at the top of it — above the recording controls — instead of the
			 * screen-corner placement the editor and dashboard use.
			 */}
			<Toaster className="pointer-events-auto" placement="top end" />
		</>
	);
}
