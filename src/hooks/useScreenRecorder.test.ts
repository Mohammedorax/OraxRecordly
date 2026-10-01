import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	createBrowserRecordingOptions,
	createProcessedMicrophoneConstraints,
	normalizeBrowserMicrophoneProfile,
	resolveBrowserCaptureCursorPolicy,
	shouldUseNativeWindowsCaptureForSource,
	stopAndDiscardNativeCapture,
} from "./useScreenRecorder";

type RecordingState = "inactive" | "recording" | "paused";

function createMockMediaRecorder(initialState: RecordingState = "inactive") {
	let _state: RecordingState = initialState;
	return {
		get state() {
			return _state;
		},
		pause: vi.fn(() => {
			if (_state === "recording") _state = "paused";
		}),
		resume: vi.fn(() => {
			if (_state === "paused") _state = "recording";
		}),
		requestData: vi.fn(),
		stop: vi.fn(() => {
			_state = "inactive";
		}),
		start: vi.fn(() => {
			_state = "recording";
		}),
	};
}

describe("createProcessedMicrophoneConstraints", () => {
	it("requests browser voice processing with AGC for the default microphone", () => {
		expect(createProcessedMicrophoneConstraints()).toEqual({
			audio: {
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: true,
				channelCount: { ideal: 1 },
				sampleRate: { ideal: 48000 },
			},
			video: false,
		});
	});

	it("keeps default voice processing when a specific microphone is selected", () => {
		expect(createProcessedMicrophoneConstraints("device-123")).toMatchObject({
			audio: {
				deviceId: { exact: "device-123" },
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: true,
				channelCount: { ideal: 1 },
				sampleRate: { ideal: 48000 },
			},
			video: false,
		});
	});

	it("can request the legacy browser processed profile for lab comparisons", () => {
		expect(createProcessedMicrophoneConstraints(undefined, "processed")).toMatchObject({
			audio: {
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: true,
			},
			video: false,
		});
	});

	it("can disable AGC for lab comparisons", () => {
		expect(createProcessedMicrophoneConstraints(undefined, "no-agc")).toMatchObject({
			audio: {
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: false,
			},
			video: false,
		});
	});

	it("can disable echo cancellation for lab comparisons", () => {
		expect(createProcessedMicrophoneConstraints(undefined, "no-echo")).toMatchObject({
			audio: {
				echoCancellation: false,
				noiseSuppression: true,
				autoGainControl: true,
			},
			video: false,
		});
	});

	it("can request a raw browser microphone stream for lab comparisons", () => {
		expect(createProcessedMicrophoneConstraints(undefined, "raw")).toMatchObject({
			audio: {
				echoCancellation: false,
				noiseSuppression: false,
				autoGainControl: false,
			},
			video: false,
		});
	});

	it("normalizes invalid lab microphone profiles to production voice processing", () => {
		expect(normalizeBrowserMicrophoneProfile("RAW")).toBe("raw");
		expect(normalizeBrowserMicrophoneProfile("unknown")).toBe("processed");
		expect(normalizeBrowserMicrophoneProfile(null)).toBe("processed");
	});
});

describe("createBrowserRecordingOptions", () => {
	it("sets an aggregate bitrate target for browser screen recordings", () => {
		expect(
			createBrowserRecordingOptions({
				audioBitsPerSecond: 128_000,
				mimeType: "video/webm;codecs=vp9",
				videoBitsPerSecond: 30_600_000,
			}),
		).toEqual({
			audioBitsPerSecond: 128_000,
			bitsPerSecond: 30_728_000,
			mimeType: "video/webm;codecs=vp9",
			videoBitsPerSecond: 30_600_000,
		});
	});

	it("keeps video-only recordings on the requested video budget", () => {
		expect(
			createBrowserRecordingOptions({
				videoBitsPerSecond: 30_600_000,
			}),
		).toEqual({
			bitsPerSecond: 30_600_000,
			videoBitsPerSecond: 30_600_000,
		});
	});
});

describe("resolveBrowserCaptureCursorPolicy", () => {
	it("preserves the existing hidden-cursor browser policy by default", () => {
		expect(resolveBrowserCaptureCursorPolicy()).toEqual({
			streamCursor: "never",
			hideOsCursorBeforeRecording: true,
			hideEditorOverlayCursorByDefault: true,
		});
	});

	it("uses the browser captured cursor after native Windows capture fails to start", () => {
		expect(
			resolveBrowserCaptureCursorPolicy({ nativeWindowsCaptureStartFailed: true }),
		).toEqual({
			streamCursor: "always",
			hideOsCursorBeforeRecording: false,
			hideEditorOverlayCursorByDefault: true,
		});
	});
});

describe("shouldUseNativeWindowsCaptureForSource", () => {
	it("keeps native Windows capture on screen sources", () => {
		expect(shouldUseNativeWindowsCaptureForSource({ id: "screen:101:0" })).toBe(true);
	});

	it("keeps native Windows capture on window sources", () => {
		expect(shouldUseNativeWindowsCaptureForSource({ id: "window:123456:0" })).toBe(true);
	});

	it("keeps browser capture for non-desktop sources", () => {
		expect(shouldUseNativeWindowsCaptureForSource({ id: "browser-tab:abc" })).toBe(false);
	});
});

describe("stopAndDiscardNativeCapture", () => {
	it("deletes the partial recording after a successful warm-start stop", async () => {
		const deleteRecordingFile = vi.fn().mockResolvedValue(undefined);

		await expect(
			stopAndDiscardNativeCapture({
				stopNativeScreenRecording: vi.fn().mockResolvedValue({
					success: true,
					path: "C:\\Recordly\\warm-start.mp4",
				}),
				deleteRecordingFile,
			}),
		).resolves.toEqual({
			stopSucceeded: true,
			deleteSucceeded: true,
			path: "C:\\Recordly\\warm-start.mp4",
		});
		expect(deleteRecordingFile).toHaveBeenCalledWith("C:\\Recordly\\warm-start.mp4");
	});

	it("reports an unsuccessful stop without deleting or confirming cleanup", async () => {
		const deleteRecordingFile = vi.fn();

		await expect(
			stopAndDiscardNativeCapture({
				stopNativeScreenRecording: vi.fn().mockResolvedValue({
					success: false,
					error: "helper still running",
				}),
				deleteRecordingFile,
			}),
		).resolves.toEqual({
			stopSucceeded: false,
			deleteSucceeded: false,
			error: "helper still running",
		});
		expect(deleteRecordingFile).not.toHaveBeenCalled();
	});

	it("keeps the stopped path available when deletion fails so cleanup can retry", async () => {
		const deleteError = new Error("file locked");

		await expect(
			stopAndDiscardNativeCapture({
				stopNativeScreenRecording: vi.fn().mockResolvedValue({
					success: true,
					path: "C:\\Recordly\\warm-start.mp4",
				}),
				deleteRecordingFile: vi.fn().mockRejectedValue(deleteError),
			}),
		).resolves.toEqual({
			stopSucceeded: true,
			deleteSucceeded: false,
			path: "C:\\Recordly\\warm-start.mp4",
			error: deleteError,
		});
	});
});

function stopRecording(
	recorder: ReturnType<typeof createMockMediaRecorder>,
	isNativeRecording: boolean,
) {
	if (isNativeRecording) {
		return { stopped: true, wasNative: true };
	}

	const recorderState = recorder.state;
	if (recorderState === "recording" || recorderState === "paused") {
		if (recorderState === "paused") {
			try {
				recorder.resume();
			} catch {
				// Stopping a paused recorder is still valid; mirror the hook's fallback path.
			}
		}
		try {
			recorder.requestData();
		} catch {
			// Stopping should continue even if the browser refuses an explicit flush.
		}
		recorder.stop();
		return { stopped: true, wasNative: false };
	}
	return { stopped: false, wasNative: false };
}

function pauseRecording(
	recorder: ReturnType<typeof createMockMediaRecorder>,
	recording: boolean,
	paused: boolean,
	isNativeRecording: boolean,
	micFallbackRecorder?: ReturnType<typeof createMockMediaRecorder> | null,
): boolean {
	if (!recording || paused) return false;
	if (isNativeRecording) {
		if (micFallbackRecorder?.state === "recording") {
			micFallbackRecorder.requestData();
			micFallbackRecorder.pause();
		}
		return true;
	}
	if (recorder.state === "recording") {
		recorder.pause();
		return true;
	}
	return false;
}

function resumeRecording(
	recorder: ReturnType<typeof createMockMediaRecorder>,
	recording: boolean,
	paused: boolean,
	isNativeRecording: boolean,
	micFallbackRecorder?: ReturnType<typeof createMockMediaRecorder> | null,
): boolean {
	if (!recording || !paused) return false;
	if (isNativeRecording) {
		if (micFallbackRecorder?.state === "paused") {
			micFallbackRecorder.resume();
		}
		return true;
	}
	if (recorder.state === "paused") {
		recorder.resume();
		return true;
	}
	return false;
}

function cancelRecording(
	recorder: ReturnType<typeof createMockMediaRecorder>,
	isNativeRecording: boolean,
	chunks: { current: Blob[] },
	stopMicFallbackRecorder?: () => Promise<Blob | null>,
) {
	if (isNativeRecording) {
		void stopMicFallbackRecorder?.();
		return { cancelled: true, wasNative: true };
	}

	chunks.current = [];
	if (recorder.state !== "inactive") {
		recorder.stop();
	}
	return { cancelled: true, wasNative: false };
}

describe("useScreenRecorder state machine", () => {
	let recorder: ReturnType<typeof createMockMediaRecorder>;

	beforeEach(() => {
		recorder = createMockMediaRecorder("recording");
	});

	describe("stopRecording", () => {
		it("stops from recording state", () => {
			const result = stopRecording(recorder, false);

			expect(result.stopped).toBe(true);
			expect(recorder.stop).toHaveBeenCalled();
			expect(recorder.resume).not.toHaveBeenCalled();
			expect(recorder.state).toBe("inactive");
		});

		it("resumes then stops from paused state", () => {
			recorder.pause();
			expect(recorder.state).toBe("paused");

			const result = stopRecording(recorder, false);

			expect(result.stopped).toBe(true);
			expect(recorder.resume).toHaveBeenCalled();
			expect(recorder.stop).toHaveBeenCalled();
			expect(recorder.state).toBe("inactive");
		});

		it("resume is called before stop when paused", () => {
			recorder.pause();
			const callOrder: string[] = [];
			recorder.resume.mockImplementation(() => {
				callOrder.push("resume");
			});
			recorder.stop.mockImplementation(() => {
				callOrder.push("stop");
			});

			stopRecording(recorder, false);

			expect(callOrder).toEqual(["resume", "stop"]);
		});

		it("flushes the current recorder data before stopping", () => {
			const callOrder: string[] = [];
			recorder.requestData.mockImplementation(() => {
				callOrder.push("requestData");
			});
			recorder.stop.mockImplementation(() => {
				callOrder.push("stop");
			});

			stopRecording(recorder, false);

			expect(callOrder).toEqual(["requestData", "stop"]);
		});

		it("resumes, flushes, then stops from paused state", () => {
			recorder.pause();
			const callOrder: string[] = [];
			recorder.resume.mockImplementation(() => {
				callOrder.push("resume");
			});
			recorder.requestData.mockImplementation(() => {
				callOrder.push("requestData");
			});
			recorder.stop.mockImplementation(() => {
				callOrder.push("stop");
			});

			stopRecording(recorder, false);

			expect(callOrder).toEqual(["resume", "requestData", "stop"]);
		});

		it("still stops when the explicit data flush fails", () => {
			recorder.requestData.mockImplementation(() => {
				throw new Error("flush failed");
			});

			const result = stopRecording(recorder, false);

			expect(result.stopped).toBe(true);
			expect(recorder.stop).toHaveBeenCalled();
		});

		it("still stops from paused state when the explicit data flush fails", () => {
			recorder.pause();
			const callOrder: string[] = [];
			recorder.resume.mockImplementation(() => {
				callOrder.push("resume");
			});
			recorder.requestData.mockImplementation(() => {
				callOrder.push("requestData");
				throw new Error("flush failed");
			});
			recorder.stop.mockImplementation(() => {
				callOrder.push("stop");
			});

			const result = stopRecording(recorder, false);

			expect(result.stopped).toBe(true);
			expect(callOrder).toEqual(["resume", "requestData", "stop"]);
		});

		it("still stops when resume throws from paused state", () => {
			recorder.pause();
			recorder.resume.mockImplementation(() => {
				throw new Error("resume failed");
			});

			const result = stopRecording(recorder, false);

			expect(result.stopped).toBe(true);
			expect(recorder.stop).toHaveBeenCalled();
			expect(recorder.state).toBe("inactive");
		});

		it("does nothing when already inactive", () => {
			const inactiveRecorder = createMockMediaRecorder("inactive");

			const result = stopRecording(inactiveRecorder, false);

			expect(result.stopped).toBe(false);
			expect(inactiveRecorder.stop).not.toHaveBeenCalled();
		});

		it("delegates to native path for native recordings", () => {
			const result = stopRecording(recorder, true);

			expect(result.stopped).toBe(true);
			expect(result.wasNative).toBe(true);
			expect(recorder.stop).not.toHaveBeenCalled();
		});
	});

	describe("pauseRecording", () => {
		it("pauses an active recording", () => {
			const result = pauseRecording(recorder, true, false, false);

			expect(result).toBe(true);
			expect(recorder.pause).toHaveBeenCalled();
			expect(recorder.state).toBe("paused");
		});

		it("does nothing when already paused", () => {
			recorder.pause();
			recorder.pause.mockClear();

			const result = pauseRecording(recorder, true, true, false);

			expect(result).toBe(false);
			expect(recorder.pause).not.toHaveBeenCalled();
		});

		it("does nothing when not recording", () => {
			const result = pauseRecording(recorder, false, false, false);

			expect(result).toBe(false);
			expect(recorder.pause).not.toHaveBeenCalled();
		});

		it("allows pause for native recordings", () => {
			const result = pauseRecording(recorder, true, false, true);

			expect(result).toBe(true);
		});

		it("pauses browser mic fallback during native recording pause", () => {
			const micFallback = createMockMediaRecorder("recording");

			const result = pauseRecording(recorder, true, false, true, micFallback);

			expect(result).toBe(true);
			expect(micFallback.requestData).toHaveBeenCalled();
			expect(micFallback.state).toBe("paused");
		});
	});

	describe("resumeRecording", () => {
		it("resumes a paused recording", () => {
			recorder.pause();

			const result = resumeRecording(recorder, true, true, false);

			expect(result).toBe(true);
			expect(recorder.resume).toHaveBeenCalled();
			expect(recorder.state).toBe("recording");
		});

		it("does nothing when not paused", () => {
			const result = resumeRecording(recorder, true, false, false);

			expect(result).toBe(false);
			expect(recorder.resume).not.toHaveBeenCalled();
		});

		it("does nothing when not recording", () => {
			const result = resumeRecording(recorder, false, true, false);

			expect(result).toBe(false);
		});

		it("resumes browser mic fallback during native recording resume", () => {
			const micFallback = createMockMediaRecorder("recording");
			micFallback.pause();

			const result = resumeRecording(recorder, true, true, true, micFallback);

			expect(result).toBe(true);
			expect(micFallback.state).toBe("recording");
		});
	});

	describe("cancelRecording", () => {
		it("clears chunks and stops browser recording", () => {
			const chunks = { current: [new Blob(["data"])] };

			const result = cancelRecording(recorder, false, chunks);

			expect(result.cancelled).toBe(true);
			expect(result.wasNative).toBe(false);
			expect(chunks.current).toEqual([]);
			expect(recorder.stop).toHaveBeenCalled();
			expect(recorder.state).toBe("inactive");
		});

		it("stops the mic fallback recorder when cancelling native recording", () => {
			const chunks = { current: [] as Blob[] };
			const stopMicFallbackRecorder = vi.fn(() => Promise.resolve(null));

			const result = cancelRecording(recorder, true, chunks, stopMicFallbackRecorder);

			expect(result.wasNative).toBe(true);
			expect(stopMicFallbackRecorder).toHaveBeenCalled();
		});

		it("handles cancel when recorder is already inactive", () => {
			const inactiveRecorder = createMockMediaRecorder("inactive");
			const chunks = { current: [new Blob(["data"])] };

			const result = cancelRecording(inactiveRecorder, false, chunks);

			expect(result.cancelled).toBe(true);
			expect(chunks.current).toEqual([]);
			expect(inactiveRecorder.stop).not.toHaveBeenCalled();
		});
	});

	describe("pause → stop → editor flow", () => {
		it("record → pause → stop completes cleanly", () => {
			expect(recorder.state).toBe("recording");

			pauseRecording(recorder, true, false, false);
			expect(recorder.state).toBe("paused");

			const result = stopRecording(recorder, false);
			expect(result.stopped).toBe(true);
			expect(recorder.state).toBe("inactive");
		});

		it("record → pause → resume → stop completes cleanly", () => {
			expect(recorder.state).toBe("recording");

			pauseRecording(recorder, true, false, false);
			expect(recorder.state).toBe("paused");

			resumeRecording(recorder, true, true, false);
			expect(recorder.state).toBe("recording");

			const result = stopRecording(recorder, false);
			expect(result.stopped).toBe(true);
			expect(recorder.state).toBe("inactive");
		});
	});
});
