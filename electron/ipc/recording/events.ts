import { BrowserWindow } from "electron";

export function emitRecordingInterrupted(reason: string, message: string) {
	BrowserWindow.getAllWindows().forEach((window) => {
		if (!window.isDestroyed()) {
			window.webContents.send("recording-interrupted", { reason, message });
		}
	});
}
