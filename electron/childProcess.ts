import { type ChildProcess, execFile } from "node:child_process";

/**
 * Windows shows a console window for every console-subsystem child process
 * (ffmpeg, ffprobe, taskkill, …) unless `windowsHide` is set. Electron runs as a
 * GUI process, so a missing flag puts a black console window on screen — and for
 * the export encoder it stays there for the entire export, showing the ffmpeg
 * command line with the temp output path.
 *
 * Always pass these options to `spawn` / `execFile` in the main process. A
 * regression test (`childProcessWindowsHide.test.ts`) fails the build if a new
 * spawn site forgets them.
 */
export const HIDDEN_WINDOW_OPTIONS = { windowsHide: true } as const;

/**
 * Kills a child process and everything it spawned.
 *
 * On Windows a plain `child.kill()` only signals the direct child, so encoder
 * helpers can outlive a cancelled export and keep the output file locked.
 * `taskkill /T` removes the whole tree; other platforms already signal the tree
 * they need. Falls back to a direct kill when taskkill is unavailable.
 */
export function killProcessTree(child: ChildProcess, signal: NodeJS.Signals = "SIGKILL"): void {
	const killDirect = () => {
		try {
			child.kill(signal);
		} catch {
			// Process already exited.
		}
	};

	const pid = child.pid;
	if (!pid || process.platform !== "win32") {
		killDirect();
		return;
	}

	execFile("taskkill", ["/pid", String(pid), "/T", "/F"], HIDDEN_WINDOW_OPTIONS, (error) => {
		if (error) {
			killDirect();
		}
	});
}
