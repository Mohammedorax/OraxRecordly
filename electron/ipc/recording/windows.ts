import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { BrowserWindow } from "electron";
import { stopWindowBoundsCapture } from "../cursor/bounds";
import { stopInteractionCapture } from "../cursor/interaction";
import { stopCursorCapture } from "../cursor/telemetry";
import { getWindowsCaptureExePath } from "../paths/binaries";
import {
	selectedSource,
	setWindowsCaptureProcess,
	setWindowsCaptureStopRequested,
	setWindowsNativeCaptureActive,
	windowsCaptureOutputBuffer,
	windowsCaptureStopRequested,
	windowsCaptureTargetPath,
	windowsNativeCaptureActive,
} from "../state";
import { AudioSyncAdjustment } from "../types";
import { moveFileWithOverwrite } from "../utils";
import { emitRecordingInterrupted } from "./events";

const execFileAsync = promisify(execFile);

/**
 * Stopping the native helper used to be as slow as the recording was idle:
 * `MFEncoder::extendLastFrameTo` (`electron/native/wgc-capture/src/mf_encoder.cpp`)
 * re-encoded one duplicate frame per missing interval between the last captured
 * frame and the stop timestamp, and Windows Graphics Capture delivers no frames
 * while the captured content is static. Measured on the old binary: 20 s of
 * static screen took ~23-42 s to stop, 40 s did not stop within 60 s. The old
 * 45 s timeout only killed the helper *after* that catch-up burst, which left an
 * MP4 with no `moov` atom (unplayable, "moov atom not found") and aborted the
 * finish path — the recording was lost and the editor never opened.
 *
 * The helper now caps the backfill at a handful of frames (see
 * `kMaxBackfillFrames` in `mf_encoder.cpp`) and jumps the timeline instead, so a
 * stop is fast no matter how long the screen was idle: measured 0.1-1.3 s for
 * 5/20/40 s idle spans, with `moov` and an exact duration still written.
 *
 * The budget below stays deliberately short as defence in depth: either the
 * helper exits on its own, or it is terminated immediately and the recording is
 * recovered from whatever is already on disk.
 */
export const WINDOWS_CAPTURE_STOP_GRACE_MS = 3_000;
export const WINDOWS_CAPTURE_STOP_KILL_WAIT_MS = 2_000;
export const WINDOWS_CAPTURE_FORCE_KILL_TIMEOUT_MS = 5_000;
/** Grace period after `exit` for the last stdout chunks to be delivered. */
export const WINDOWS_CAPTURE_EXIT_DRAIN_MS = 100;

export type WindowsCaptureStopOutcome = {
	/** Path reported by the helper, the tracked target, or the tracked temp file. */
	outputPath: string | null;
	/** True when the helper had to be terminated instead of exiting on its own. */
	forced: boolean;
	/** True when the graceful budget expired. */
	timedOut: boolean;
	/** Helper diagnostics, set when the helper exited without a usable result. */
	error: string | null;
};

export type NativeWindowsVideoPaddingResult = {
	padded: boolean;
	durationSeconds: number;
	containerDurationSeconds: number;
	targetDurationSeconds: number;
	padDurationSeconds: number;
};

export type NativeWindowsAudioMuxResult = {
	muxed: boolean;
	videoDurationSeconds: number;
	muxTimeoutMs: number;
	audioInputs: string[];
	audio: Record<
		string,
		{
			path: string;
			sizeBytes: number;
			durationSeconds: number;
			startDelayMs: number | null;
			adjustment: AudioSyncAdjustment;
		}
	>;
	outputPath?: string;
	keptAudioSidecars?: boolean;
};

export async function isNativeWindowsCaptureAvailable(): Promise<boolean> {
	if (process.platform !== "win32") return false;

	const os = await import("node:os");
	const [major, , build] = os.release().split(".").map(Number);
	const supported = major >= 10 && build >= 19041;
	if (!supported) return false;

	try {
		await fs.access(getWindowsCaptureExePath(), fsConstants.X_OK);
	} catch {
		return false;
	}

	return true;
}

export function waitForWindowsCaptureStart(proc: ChildProcessWithoutNullStreams) {
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error("Timed out waiting for native Windows capture to start"));
		}, 12000);

		let stdoutBuffer = "";
		const onStdout = (chunk: Buffer) => {
			stdoutBuffer += chunk.toString();
			if (stdoutBuffer.includes("Recording started")) {
				cleanup();
				resolve();
			}
		};

		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		const onExit = (code: number | null) => {
			cleanup();
			reject(
				new Error(
					windowsCaptureOutputBuffer.trim() ||
						`Native Windows capture exited before recording started (code ${code ?? "unknown"})`,
				),
			);
		};

		const cleanup = () => {
			clearTimeout(timer);
			proc.stdout.off("data", onStdout);
			proc.off("error", onError);
			proc.off("exit", onExit);
		};

		proc.stdout.on("data", onStdout);
		proc.once("error", onError);
		proc.once("exit", onExit);
	});
}

/**
 * Sends the stop request to the helper and resolves once the process is gone or
 * the bounded budget expired.
 *
 * Two stop signals are sent on purpose: the `stop` line is what
 * `stdinListenerThread()` compares against
 * (`electron/native/wgc-capture/src/main.cpp:275-279`), and stdin EOF is the
 * helper's documented fallback ("stdin closed (parent process died)",
 * `main.cpp:282-284`). Every shipped helper revision honours at least one of
 * them, so a stop can never be silently dropped.
 */
function writeWindowsCaptureStopCommand(proc: ChildProcessWithoutNullStreams) {
	const stdin = proc.stdin;
	if (!stdin) {
		return;
	}

	// A helper that already died makes the write fail with EPIPE; that must not
	// surface as an unhandled stream error.
	stdin.on("error", () => undefined);

	try {
		if (!stdin.destroyed && stdin.writable) {
			stdin.write("stop\n");
		}
	} catch {
		// The pipe may already be gone; EOF below still triggers the stop path.
	}

	try {
		if (!stdin.destroyed) {
			stdin.end();
		}
	} catch {
		// Nothing else to do; the exit wait below bounds the call.
	}
}

type WindowsCaptureExitResult = { exited: boolean; code: number | null; error?: string };

function hasWindowsCaptureExited(proc: ChildProcessWithoutNullStreams) {
	const state = proc as { exitCode?: number | null; signalCode?: NodeJS.Signals | null };
	return (state.exitCode ?? null) !== null || (state.signalCode ?? null) !== null;
}

function waitForWindowsCaptureExit(
	proc: ChildProcessWithoutNullStreams,
	timeoutMs: number,
): Promise<WindowsCaptureExitResult> {
	if (hasWindowsCaptureExited(proc)) {
		return Promise.resolve({ exited: true, code: proc.exitCode });
	}

	return new Promise((resolve) => {
		let settled = false;
		let drainTimer: NodeJS.Timeout | null = null;

		const finish = (result: WindowsCaptureExitResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (drainTimer) clearTimeout(drainTimer);
			proc.off("close", onClose);
			proc.off("exit", onExit);
			proc.off("error", onError);
			resolve(result);
		};

		const timer = setTimeout(() => finish({ exited: false, code: proc.exitCode }), timeoutMs);

		// `exit` is authoritative: `close` waits for the stdio handles, and a
		// lingering handle must not keep the stop path waiting. The short drain
		// window still lets the final "Recording stopped." line arrive.
		const onExit = (code: number | null) => {
			if (drainTimer) return;
			drainTimer = setTimeout(
				() => finish({ exited: true, code }),
				WINDOWS_CAPTURE_EXIT_DRAIN_MS,
			);
		};
		const onClose = (code: number | null) => finish({ exited: true, code });
		const onError = (error: Error) =>
			finish({ exited: true, code: proc.exitCode, error: error.message });

		proc.once("close", onClose);
		proc.once("exit", onExit);
		proc.once("error", onError);
	});
}

function readWindowsCaptureStopOutputPath(): string | null {
	const match = windowsCaptureOutputBuffer.match(/Recording stopped\. Output path: (.+)/);
	const reported = match?.[1]?.trim();
	return reported && reported.length > 0 ? reported : null;
}

/**
 * Terminates the helper and every process it spawned. `proc.kill()` alone only
 * terminates the direct child on Windows, so the tree is killed through
 * `taskkill` as well; the direct child is terminated immediately in parallel
 * because spawning `taskkill` costs hundreds of milliseconds and the helper must
 * not survive the stop budget.
 */
export async function killWindowsCaptureProcessTree(
	proc: ChildProcessWithoutNullStreams,
	platform: NodeJS.Platform = process.platform,
): Promise<void> {
	const pid = proc.pid;
	const treeKill =
		platform === "win32" && typeof pid === "number" && pid > 0
			? execFileAsync("taskkill", ["/pid", String(pid), "/T", "/F"], {
					timeout: WINDOWS_CAPTURE_FORCE_KILL_TIMEOUT_MS,
					windowsHide: true,
				}).catch(() => undefined)
			: Promise.resolve();

	try {
		if (!proc.killed) {
			proc.kill();
		}
	} catch {
		// The process is already gone; the bounded wait below still applies.
	}

	await treeKill;
}

/**
 * Bounded, idempotent stop of the native Windows capture helper.
 *
 * Never hangs and never rejects: the caller decides what to do with the
 * outcome. When the graceful budget expires the helper is terminated
 * immediately (not after a 45 s timeout) and the bytes it already wrote are
 * reported through `outputPath` so the caller can validate/recover them.
 */
export async function stopWindowsCaptureProcess(
	proc: ChildProcessWithoutNullStreams,
	options: { graceMs?: number; killWaitMs?: number; platform?: NodeJS.Platform } = {},
): Promise<WindowsCaptureStopOutcome> {
	const graceMs = Math.max(0, options.graceMs ?? WINDOWS_CAPTURE_STOP_GRACE_MS);
	const killWaitMs = Math.max(0, options.killWaitMs ?? WINDOWS_CAPTURE_STOP_KILL_WAIT_MS);
	const platform = options.platform ?? process.platform;

	// Idempotency: a second stop for an already-exited helper resolves
	// immediately instead of waiting out another budget.
	if (hasWindowsCaptureExited(proc)) {
		return {
			outputPath: readWindowsCaptureStopOutputPath() ?? windowsCaptureTargetPath,
			forced: false,
			timedOut: false,
			error: null,
		};
	}

	writeWindowsCaptureStopCommand(proc);

	const graceful = await waitForWindowsCaptureExit(proc, graceMs);
	if (graceful.exited) {
		const outputPath = readWindowsCaptureStopOutputPath();
		if (outputPath) {
			return { outputPath, forced: false, timedOut: false, error: null };
		}

		if (graceful.code === 0 && windowsCaptureTargetPath) {
			return {
				outputPath: windowsCaptureTargetPath,
				forced: false,
				timedOut: false,
				error: null,
			};
		}

		const reportedError = windowsCaptureOutputBuffer.trim();
		return {
			outputPath: windowsCaptureTargetPath,
			forced: false,
			timedOut: false,
			error:
				graceful.error ??
				(reportedError.length > 0
					? reportedError
					: `Native Windows capture exited with code ${graceful.code ?? "unknown"}`),
		};
	}

	// The helper is stuck (typically the encoder catch-up burst). Terminate the
	// tree now, then give the handles a brief moment to settle so the caller can
	// still read whatever the helper flushed.
	await killWindowsCaptureProcessTree(proc, platform);
	const afterKill = await waitForWindowsCaptureExit(proc, killWaitMs);

	return {
		outputPath: readWindowsCaptureStopOutputPath() ?? windowsCaptureTargetPath,
		forced: true,
		timedOut: true,
		error:
			afterKill.error ??
			(afterKill.exited
				? null
				: "Native Windows capture did not exit after being terminated"),
	};
}

export function attachWindowsCaptureLifecycle(proc: ChildProcessWithoutNullStreams) {
	proc.once("close", () => {
		const wasActive = windowsNativeCaptureActive;
		setWindowsCaptureProcess(null);

		if (!wasActive || windowsCaptureStopRequested) {
			return;
		}

		setWindowsNativeCaptureActive(false);
		setWindowsCaptureStopRequested(false);

		// The capture process stopped outside the normal stop path, so the cursor
		// hook, window-bounds poll and cursor sampler must be torn down here too.
		// All three stop functions are idempotent.
		stopCursorCapture();
		stopInteractionCapture();
		stopWindowBoundsCapture();

		const sourceName = selectedSource?.name ?? "Screen";
		BrowserWindow.getAllWindows().forEach((window) => {
			if (!window.isDestroyed()) {
				window.webContents.send("recording-state-changed", {
					recording: false,
					sourceName,
				});
			}
		});

		emitRecordingInterrupted("capture-stopped", "Recording stopped unexpectedly.");
	});
}

export async function muxNativeWindowsVideoWithAudio(
	videoPath: string,
	systemAudioPath: string | null,
	micAudioPath: string | null,
): Promise<NativeWindowsAudioMuxResult> {
	const start = Date.now();
	console.log("[PERF:MAIN] muxNativeWindowsVideoWithAudio: STARTED");
	const audio: NativeWindowsAudioMuxResult["audio"] = {};
	const audioInputs: string[] = [];

	const videoPathWithoutExt = videoPath.replace(/\.[^.]+$/u, "");

	// Optimization: instead of heavy FFmpeg muxing, we just move the audio sidecars
	// to their final companion paths so the editor can find them as separate tracks.
	if (systemAudioPath) {
		const finalSystemPath = `${videoPathWithoutExt}.system.wav`;
		try {
			const stat = await fs.stat(systemAudioPath);
			if (stat.size > 0) {
				if (systemAudioPath !== finalSystemPath) {
					await moveFileWithOverwrite(systemAudioPath, finalSystemPath);
				}
				audioInputs.push("system");
				audio.system = {
					path: finalSystemPath,
					sizeBytes: stat.size,
					durationSeconds: 0,
					startDelayMs: null,
					adjustment: { mode: "none", delayMs: 0, tempoRatio: 1, durationDeltaMs: 0 },
				};
			}
		} catch (err) {
			console.error(`[mux-win] Failed to handle system audio:`, err);
		}
	}

	if (micAudioPath) {
		const finalMicPath = `${videoPathWithoutExt}.mic.wav`;
		try {
			const stat = await fs.stat(micAudioPath);
			if (stat.size > 0) {
				if (micAudioPath !== finalMicPath) {
					await moveFileWithOverwrite(micAudioPath, finalMicPath);
				}
				audioInputs.push("mic");
				audio.mic = {
					path: finalMicPath,
					sizeBytes: stat.size,
					durationSeconds: 0,
					startDelayMs: null,
					adjustment: { mode: "none", delayMs: 0, tempoRatio: 1, durationDeltaMs: 0 },
				};
			}
		} catch (err) {
			console.error(`[mux-win] Failed to handle mic audio:`, err);
		}
	}

	console.log(`[PERF:MAIN] muxNativeWindowsVideoWithAudio: COMPLETED in ${Date.now() - start}ms`);

	return {
		muxed: false,
		videoDurationSeconds: 0, // No longer needed here
		muxTimeoutMs: 0,
		audioInputs,
		audio,
		keptAudioSidecars: true,
	};
}
