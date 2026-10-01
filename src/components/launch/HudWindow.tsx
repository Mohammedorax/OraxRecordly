import { Toaster } from "../ui/toast";
import { LaunchWindow } from "./LaunchWindow";

export default function HudWindow() {
	return (
		<>
			<LaunchWindow />
			{/*
			 * The HUD is a compact bottom-anchored window, so toasts are placed
			 * at the top of it — above the recording controls — instead of the
			 * screen-corner placement the editor and dashboard use.
			 */}
			<Toaster className="pointer-events-auto" placement="top end" />
		</>
	);
}
