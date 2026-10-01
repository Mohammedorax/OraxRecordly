import { contextBridge, ipcRenderer } from "electron";
import type { RecordingSessionData } from "./ipc/types";

type NativeVideoExportWriteResult = { success: boolean; error?: string };
type NativeVideoAudioMuxMetrics = {
	tempVideoWriteMs?: number;
	tempEditedAudioWriteMs?: number;
	ffmpegExecMs?: number;
	muxedVideoReadMs?: number;
	tempVideoBytes?: number;
	tempEditedAudioBytes?: number;
	muxedVideoBytes?: number;
};
type WindowsGpuExportSummary = {
	success?: boolean;
	width?: number;
	height?: number;
	fps?: number;
	seconds?: number;
	mediaMs?: number;
	frames?: number;
	cursorOverlay?: boolean;
	zoomOverlay?: boolean;
	adapterVendorId?: number;
	adapterDeviceId?: number;
	adapterDedicatedVideoMemoryMB?: number;
	initializeMs?: number;
	initCoInitializeMs?: number;
	initMfStartupMs?: number;
	initD3DDeviceMs?: number;
	initSourceReaderMs?: number;
	initVideoProcessorMs?: number;
	initTexturesMs?: number;
	initShaderPipelineMs?: number;
	initSinkWriterMs?: number;
	totalMs?: number;
	readMs?: number;
	clearMs?: number;
	videoProcessMs?: number;
	writeSampleMs?: number;
	finalizeMs?: number;
	realtimeMultiplier?: number;
};
type NativeStaticLayoutChunkMetric = {
	index: number;
	startSec: number;
	durationSec: number;
	backend:
		| "cuda-overlay"
		| "cuda-scale-cpu-pad"
		| "cuda-static-composite"
		| "nvidia-cuda-compositor"
		| "windows-d3d11-compositor";
	elapsedMs: number;
	outputBytes: number;
	fallbackReason?: string;
	windowsGpuSummary?: WindowsGpuExportSummary;
};
type NativeStaticLayoutMetrics = NativeVideoAudioMuxMetrics & {
	chunkCount: number;
	chunkDurationSec: number;
	chunkExecMs: number;
	concatExecMs?: number;
	staticAssetExecMs?: number;
	fallbackChunkCount: number;
	videoOnlyBytes?: number;
	chunks: NativeStaticLayoutChunkMetric[];
};
type NativeStaticLayoutProgress = {
	sessionId?: string;
	backend?: NativeStaticLayoutChunkMetric["backend"];
	stage?: "preparing" | "finalizing";
	elapsedMs?: number;
	averageFps?: number;
	currentFrame: number;
	totalFrames: number;
	percentage: number;
};
type NativeVideoMetadataProbe = {
	width: number;
	height: number;
	duration: number;
	mediaStartTime?: number;
	streamStartTime?: number;
	streamDuration?: number;
	frameRate: number;
	codec: string;
	hasAudio: boolean;
	audioCodec?: string;
	audioSampleRate?: number;
};
type NativeExportCapabilities = {
	platform: NodeJS.Platform;
	nvidiaCuda: {
		available: boolean;
		skipReason: string | null;
		hasNvidiaGpu: boolean | null;
		hasWrapper: boolean;
		explicitEnabled: boolean;
		explicitDisabled: boolean;
		userOptInRequired: boolean;
	};
};
type ExportHardwareInfo = {
	platform: NodeJS.Platform;
	release: string;
	arch: string;
	cpuModel: string | null;
	logicalProcessors: number;
	totalMemoryGb: number;
	machineModel: string | null;
	gpus: Array<{
		name: string;
		vendor: string | null;
		active: boolean | null;
	}>;
	gpuFeatures: {
		videoDecode: string | null;
		videoEncode: string | null;
		webgl: string | null;
		webgpu: string | null;
	};
};

const nativeVideoExportWriteRequests = new Map<
	number,
	{
		sessionId: string;
		resolve: (result: NativeVideoExportWriteResult) => void;
	}
>();

let nextNativeVideoExportWriteRequestId = 1;
let nativeVideoExportWriteResultListenerAttached = false;

function ensureNativeVideoExportWriteResultListener() {
	if (nativeVideoExportWriteResultListenerAttached) {
		return;
	}

	nativeVideoExportWriteResultListenerAttached = true;
	ipcRenderer.on(
		"native-video-export-write-frame-result",
		(
			_event,
			payload: {
				sessionId?: string;
				requestId?: number;
				success?: boolean;
				error?: string;
			},
		) => {
			if (typeof payload?.requestId !== "number") {
				return;
			}

			const pendingRequest = nativeVideoExportWriteRequests.get(payload.requestId);
			if (!pendingRequest) {
				return;
			}

			nativeVideoExportWriteRequests.delete(payload.requestId);
			pendingRequest.resolve({
				success: payload.success === true,
				error: payload.error,
			});
		},
	);
}

function settleNativeVideoExportPendingRequests(
	sessionId: string,
	result: NativeVideoExportWriteResult,
) {
	for (const [requestId, pendingRequest] of nativeVideoExportWriteRequests.entries()) {
		if (pendingRequest.sessionId !== sessionId) {
			continue;
		}

		nativeVideoExportWriteRequests.delete(requestId);
		pendingRequest.resolve(result);
	}
}

contextBridge.exposeInMainWorld("electronAPI", {
	hudOverlaySetIgnoreMouse: (ignore: boolean) => {
		ipcRenderer.send("hud-overlay-set-ignore-mouse", ignore);
	},
	hudOverlaySetSourceSelectionActive: (active: boolean) => {
		ipcRenderer.send("hud-overlay-set-source-selection-active", active);
	},
	hudOverlayDrag: (phase: "start" | "move" | "end", screenX: number, screenY: number) => {
		ipcRenderer.send("hud-overlay-drag", phase, screenX, screenY);
	},
	hudOverlayHide: () => {
		ipcRenderer.send("hud-overlay-hide");
	},
	hudOverlayClose: () => {
		ipcRenderer.send("hud-overlay-close");
	},
	getEditorMode: () => ipcRenderer.invoke("get-editor-mode"),
	onEditorModeChanged: (callback: (inEditor: boolean) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, inEditor: boolean) =>
			callback(inEditor);
		ipcRenderer.on("editor-mode-changed", listener);
		return () => ipcRenderer.removeListener("editor-mode-changed", listener);
	},
	hudOverlayRendererReady: () => {
		ipcRenderer.send("hud-overlay-renderer-ready");
	},
	getHudOverlayCaptureProtection: () => {
		return ipcRenderer.invoke("get-hud-overlay-capture-protection");
	},
	getHudOverlayMousePassthroughSupported: () => {
		return ipcRenderer.invoke("get-hud-overlay-mouse-passthrough-supported");
	},
	setHudOverlayCaptureProtection: (enabled: boolean) => {
		return ipcRenderer.invoke("set-hud-overlay-capture-protection", enabled);
	},
	getAssetBasePath: async () => {
		return await ipcRenderer.invoke("get-asset-base-path");
	},
	listAssetDirectory: (relativeDir: string) => {
		return ipcRenderer.invoke("list-asset-directory", relativeDir);
	},
	readLocalFile: (filePath: string) => {
		return ipcRenderer.invoke("read-local-file", filePath);
	},
	generateWallpaperThumbnail: (filePath: string) => {
		return ipcRenderer.invoke("generate-wallpaper-thumbnail", filePath);
	},
	/** Lazily scans the user's machine for usable background images. */
	listSystemWallpapers: () => {
		return ipcRenderer.invoke("list-system-wallpapers") as Promise<
			import("./ipc/types").SystemWallpaperListResult
		>;
	},
	/** Native open dialog restricted to image files. */
	pickSystemWallpaperImage: () => {
		return ipcRenderer.invoke("pick-system-wallpaper-image") as Promise<
			import("./ipc/types").SystemWallpaperPickResult
		>;
	},
	probeNativeVideoMetadata: (filePath: string) => {
		return ipcRenderer.invoke("probe-native-video-metadata", filePath) as Promise<{
			success: boolean;
			metadata?: NativeVideoMetadataProbe;
			error?: string;
		}>;
	},
	getNativeExportCapabilities: () => {
		return ipcRenderer.invoke("get-native-export-capabilities") as Promise<{
			success: boolean;
			capabilities?: NativeExportCapabilities;
			error?: string;
		}>;
	},
	getExportHardwareInfo: () => {
		return ipcRenderer.invoke("get-export-hardware-info") as Promise<{
			success: boolean;
			hardware?: ExportHardwareInfo;
			error?: string;
		}>;
	},
	nativeStaticLayoutExport: (options: {
		sessionId?: string;
		inputPath: string;
		width: number;
		height: number;
		frameRate: number;
		bitrate: number;
		encodingMode: "fast" | "balanced" | "quality";
		durationSec: number;
		contentWidth: number;
		contentHeight: number;
		offsetX: number;
		offsetY: number;
		sourceCropX?: number;
		sourceCropY?: number;
		sourceCropWidth?: number;
		sourceCropHeight?: number;
		backgroundColor: string;
		backgroundImagePath?: string | null;
		backgroundBlurPx?: number;
		borderRadius?: number;
		shadowIntensity?: number;
		cursorTelemetry?: Array<{
			timeMs: number;
			cx: number;
			cy: number;
			cursorTypeIndex?: number;
			bounceScale?: number;
			visible?: boolean;
		}>;
		cursorSize?: number;
		cursorAtlasPngDataUrl?: string | null;
		cursorAtlasEntries?: Array<{
			index: number;
			x: number;
			y: number;
			width: number;
			height: number;
			anchorX: number;
			anchorY: number;
			aspectRatio: number;
		}>;
		zoomTelemetry?: Array<{ timeMs: number; scale: number; x: number; y: number }>;
		timelineSegments?: Array<{
			sourceStartMs: number;
			sourceEndMs: number;
			outputStartMs: number;
			outputEndMs: number;
			speed: number;
		}>;
		chunkDurationSec?: number;
		experimentalWindowsGpuCompositor?: boolean;
		experimentalNvidiaCudaExport?: boolean;
		audioOptions?: {
			audioMode?: "none" | "copy-source" | "trim-source" | "edited-track";
			audioSourcePath?: string | null;
			audioSourceCodec?: string | null;
			audioSourceSampleRate?: number;
			outputDurationSec?: number;
			trimSegments?: Array<{ startMs: number; endMs: number }>;
			editedTrackStrategy?: "filtergraph-fast-path" | "offline-render-fallback";
			editedTrackSegments?: Array<{ startMs: number; endMs: number; speed: number }>;
			editedAudioData?: ArrayBuffer;
			editedAudioMimeType?: string | null;
		};
	}) => {
		return ipcRenderer.invoke("native-static-layout-export", options) as Promise<{
			success: boolean;
			tempPath?: string;
			encoderName?: string;
			error?: string;
			metrics?: NativeStaticLayoutMetrics;
		}>;
	},
	nativeStaticLayoutExportCancel: (sessionId: string) => {
		return ipcRenderer.invoke("native-static-layout-export-cancel", sessionId) as Promise<{
			success: boolean;
		}>;
	},
	onNativeStaticLayoutExportProgress: (
		callback: (progress: NativeStaticLayoutProgress) => void,
	) => {
		const listener = (_event: Electron.IpcRendererEvent, payload: NativeStaticLayoutProgress) =>
			callback(payload);
		ipcRenderer.on("native-static-layout-export-progress", listener);
		return () => ipcRenderer.removeListener("native-static-layout-export-progress", listener);
	},
	nativeVideoExportStart: (options: {
		width: number;
		height: number;
		frameRate: number;
		bitrate: number;
		encodingMode: "fast" | "balanced" | "quality";
		inputMode?: "rawvideo" | "h264-stream";
	}) => {
		return ipcRenderer.invoke("native-video-export-start", options);
	},
	nativeVideoExportWriteFrame: (sessionId: string, frameData: Uint8Array) => {
		ensureNativeVideoExportWriteResultListener();

		return new Promise<NativeVideoExportWriteResult>((resolve) => {
			const requestId = nextNativeVideoExportWriteRequestId++;
			nativeVideoExportWriteRequests.set(requestId, {
				sessionId,
				resolve,
			});

			ipcRenderer.send("native-video-export-write-frame-async", {
				sessionId,
				requestId,
				frameData,
			});
		});
	},
	nativeVideoExportWriteFrames: (sessionId: string, frameDataList: Uint8Array[]) => {
		ensureNativeVideoExportWriteResultListener();

		return new Promise<NativeVideoExportWriteResult>((resolve) => {
			const requestId = nextNativeVideoExportWriteRequestId++;
			nativeVideoExportWriteRequests.set(requestId, {
				sessionId,
				resolve,
			});

			ipcRenderer.send("native-video-export-write-frames-async", {
				sessionId,
				requestId,
				frameDataList,
			});
		});
	},
	nativeVideoExportFinish: (
		sessionId: string,
		options?: {
			audioMode?: "none" | "copy-source" | "trim-source" | "edited-track";
			audioSourcePath?: string | null;
			audioSourceCodec?: string | null;
			audioSourceSampleRate?: number;
			outputDurationSec?: number;
			trimSegments?: Array<{ startMs: number; endMs: number }>;
			editedTrackStrategy?: "filtergraph-fast-path" | "offline-render-fallback";
			editedTrackSegments?: Array<{ startMs: number; endMs: number; speed: number }>;
			editedAudioData?: ArrayBuffer;
			editedAudioMimeType?: string | null;
		},
	) => {
		return ipcRenderer
			.invoke("native-video-export-finish", sessionId, options)
			.then((result) => {
				settleNativeVideoExportPendingRequests(
					sessionId,
					result?.success
						? { success: true }
						: {
								success: false,
								error:
									typeof result?.error === "string"
										? result.error
										: "Native video export session finished before all frame writes settled.",
							},
				);

				return result;
			}) as Promise<{
			success: boolean;
			data?: Uint8Array;
			encoderName?: string;
			error?: string;
			metrics?: NativeVideoAudioMuxMetrics;
		}>;
	},
	nativeVideoExportCancel: (sessionId: string) => {
		return ipcRenderer.invoke("native-video-export-cancel", sessionId).finally(() => {
			settleNativeVideoExportPendingRequests(sessionId, {
				success: false,
				error: "Native video export session was cancelled",
			});
		});
	},
	muxExportedVideoAudio: (
		videoData: ArrayBuffer,
		options?: {
			audioMode?: "none" | "copy-source" | "trim-source" | "edited-track";
			audioSourcePath?: string | null;
			audioSourceCodec?: string | null;
			audioSourceSampleRate?: number;
			outputDurationSec?: number;
			trimSegments?: Array<{ startMs: number; endMs: number }>;
			editedTrackStrategy?: "filtergraph-fast-path" | "offline-render-fallback";
			editedTrackSegments?: Array<{ startMs: number; endMs: number; speed: number }>;
			editedAudioData?: ArrayBuffer;
			editedAudioMimeType?: string | null;
		},
	) => {
		return ipcRenderer.invoke("mux-exported-video-audio", videoData, options) as Promise<{
			success: boolean;
			tempPath?: string;
			error?: string;
			metrics?: NativeVideoAudioMuxMetrics;
		}>;
	},
	muxExportedVideoAudioFromPath: (
		videoPath: string,
		options?: {
			audioMode?: "none" | "copy-source" | "trim-source" | "edited-track";
			audioSourcePath?: string | null;
			audioSourceCodec?: string | null;
			audioSourceSampleRate?: number;
			outputDurationSec?: number;
			trimSegments?: Array<{ startMs: number; endMs: number }>;
			editedTrackStrategy?: "filtergraph-fast-path" | "offline-render-fallback";
			editedTrackSegments?: Array<{ startMs: number; endMs: number; speed: number }>;
			editedAudioData?: ArrayBuffer;
			editedAudioMimeType?: string | null;
		},
	) => {
		return ipcRenderer.invoke("mux-exported-video-audio-from-path", videoPath, options);
	},
	openExportStream: (options?: { extension?: string }) => {
		return ipcRenderer.invoke("export-stream-open", options);
	},
	writeExportStreamChunk: (streamId: string, position: number, chunk: Uint8Array) => {
		return ipcRenderer.invoke("export-stream-write", streamId, position, chunk);
	},
	closeExportStream: (streamId: string, options?: { abort?: boolean }) => {
		return ipcRenderer.invoke("export-stream-close", streamId, options);
	},
	finalizeExportedVideo: (payload: {
		tempPath: string;
		fileName: string;
		outputPath?: string | null;
		captionSidecar?: {
			format: "srt" | "vtt" | "both";
			cues: Array<{
				startMs: number;
				endMs: number;
				text: string;
			}>;
		};
	}) => {
		return ipcRenderer.invoke("finalize-exported-video", payload);
	},
	discardExportedTemp: (tempPath: string) => {
		return ipcRenderer.invoke("discard-exported-temp", tempPath);
	},
	getVideoAudioFallbackPaths: (videoPath: string) => {
		return ipcRenderer.invoke("get-video-audio-fallback-paths", videoPath);
	},
	getSources: async (opts: Electron.SourcesOptions) => {
		return await ipcRenderer.invoke("get-sources", opts);
	},
	showRecordingHud: () => ipcRenderer.invoke("show-recording-hud"),
	captureScreenshot: () => {
		return ipcRenderer.invoke("capture-screenshot") as Promise<{
			success: boolean;
			path?: string;
			width?: number;
			height?: number;
			error?: string;
			// Set when the stored source was gone and the primary display was
			// captured instead; `message` explains it to the user.
			fallback?: boolean;
			message?: string;
			canceled?: boolean;
		}>;
	},
	/**
	 * Full-screen capture of the display under the cursor (or `options.displayId`)
	 * at native pixels. Independent of the selected recording source.
	 */
	captureScreenshotFullScreen: (options?: { displayId?: string }) => {
		return ipcRenderer.invoke("capture-screenshot-full-screen", options) as Promise<{
			success: boolean;
			path?: string;
			width?: number;
			height?: number;
			error?: string;
			fallback?: boolean;
			message?: string;
			canceled?: boolean;
		}>;
	},
	/**
	 * Region capture: opens the selection overlay, then resolves with the cropped
	 * image, or `{ success: false, canceled: true }` when the user cancels.
	 */
	captureScreenshotRegion: (options?: { displayId?: string }) => {
		return ipcRenderer.invoke("capture-screenshot-region", options) as Promise<{
			success: boolean;
			path?: string;
			width?: number;
			height?: number;
			error?: string;
			fallback?: boolean;
			message?: string;
			canceled?: boolean;
		}>;
	},
	/** Opens the image editor window for an existing image file. */
	openImageEditor: (path: string) => {
		return ipcRenderer.invoke("open-image-editor", path) as Promise<{
			success: boolean;
			error?: string;
		}>;
	},
	/** Reads an image file as a data URL for the image editor canvas. */
	readImageFile: (path: string) => {
		return ipcRenderer.invoke("read-image-file", path) as Promise<{
			success: boolean;
			dataUrl?: string;
			error?: string;
		}>;
	},
	/** Writes (or re-encodes) an image file from a data URL. */
	writeImageFile: (
		path: string,
		dataUrl: string,
		options?: { format?: "png" | "jpeg"; quality?: number; saveAs?: boolean },
	) => {
		return ipcRenderer.invoke("write-image-file", path, dataUrl, options) as Promise<{
			success: boolean;
			path?: string;
			error?: string;
		}>;
	},
	/**
	 * Copies text to the OS clipboard through the main process. The renderer's
	 * `navigator.clipboard` is refused in non-focused windows, so clipboard
	 * writes are performed natively.
	 */
	writeClipboardText: (text: string) => {
		return ipcRenderer.invoke("write-clipboard-text", text) as Promise<{
			success: boolean;
			error?: string;
		}>;
	},
	/** Copies a PNG data URL to the OS clipboard as an image through the main process. */
	writeClipboardImage: (dataUrl: string) => {
		return ipcRenderer.invoke("write-clipboard-image", dataUrl) as Promise<{
			success: boolean;
			error?: string;
		}>;
	},
	// ---------------------------------------------------------------------------
	// Region selector overlay (windowType=screenshot-region).
	// The overlay reports the drawn rectangle in its own client (DIP) coordinates
	// relative to the covered display; `null` (Esc / right-click) cancels and no
	// file is written.
	// ---------------------------------------------------------------------------
	completeScreenshotRegion: (
		rect: { x: number; y: number; width: number; height: number } | null,
	) => {
		ipcRenderer.send("screenshot-region-complete", rect);
	},
	/** @deprecated Use `completeScreenshotRegion(rect)`. */
	screenshotRegionComplete: (rect: { x: number; y: number; width: number; height: number }) => {
		ipcRenderer.send("screenshot-region-complete", rect);
	},
	/** @deprecated Use `completeScreenshotRegion(null)`. */
	screenshotRegionCancel: () => {
		ipcRenderer.send("screenshot-region-complete", null);
	},
	onScreenshotRegionReady: (
		callback: (payload: {
			displayId: string;
			scaleFactor: number;
			bounds: { x: number; y: number; width: number; height: number };
		}) => void,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: {
				displayId: string;
				scaleFactor: number;
				bounds: { x: number; y: number; width: number; height: number };
			},
		) => callback(payload);
		ipcRenderer.on("screenshot-region-ready", listener);
		return () => ipcRenderer.removeListener("screenshot-region-ready", listener);
	},
	// ---------------------------------------------------------------------------
	// Image editor (windowType=image-editor).
	// ---------------------------------------------------------------------------
	onImageEditorLoadImage: (callback: (payload: { filePath: string }) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, payload: { filePath: string }) =>
			callback(payload);
		ipcRenderer.on("image-editor-load-image", listener);
		return () => ipcRenderer.removeListener("image-editor-load-image", listener);
	},
	// ---------------------------------------------------------------------------
	// Screenshot library (dashboard "Screenshots" section).
	// ---------------------------------------------------------------------------
	listScreenshots: () => ipcRenderer.invoke("list-screenshots"),
	deleteScreenshot: (path: string) => ipcRenderer.invoke("delete-screenshot", path),
	// ---------------------------------------------------------------------------
	// Screenshot preferences.
	// ---------------------------------------------------------------------------
	getScreenshotPreferences: () => {
		return ipcRenderer.invoke("get-screenshot-preferences") as Promise<{
			success: boolean;
			preferences?: {
				format: "png" | "jpeg";
				jpegQuality: number;
				openEditorAfterCapture: boolean;
				globalShortcut: string | null;
				copyToClipboard: boolean;
				captureDelayMs: 0 | 3000 | 5000;
				lastCaptureMode: "fullscreen" | "region" | "source" | null;
				fileNameTemplate: string;
				folder: string | null;
			};
			error?: string;
		}>;
	},
	setScreenshotPreferences: (patch: {
		format?: "png" | "jpeg";
		jpegQuality?: number;
		openEditorAfterCapture?: boolean;
		globalShortcut?: string | null;
		copyToClipboard?: boolean;
		captureDelayMs?: number;
		lastCaptureMode?: "fullscreen" | "region" | "source" | null;
		fileNameTemplate?: string;
		folder?: string | null;
	}) => {
		return ipcRenderer.invoke("set-screenshot-preferences", patch) as Promise<{
			success: boolean;
			preferences?: {
				format: "png" | "jpeg";
				jpegQuality: number;
				openEditorAfterCapture: boolean;
				globalShortcut: string | null;
				copyToClipboard: boolean;
				captureDelayMs: 0 | 3000 | 5000;
				lastCaptureMode: "fullscreen" | "region" | "source" | null;
				fileNameTemplate: string;
				folder: string | null;
			};
			/**
			 * `null` when the shortcut is intentionally disabled, `false` when the OS
			 * refused to register the accelerator.
			 */
			shortcutRegistered?: boolean | null;
			error?: string;
		}>;
	},
	// ---------------------------------------------------------------------------
	// Screenshots folder.
	// ---------------------------------------------------------------------------
	getScreenshotsFolder: () => {
		return ipcRenderer.invoke("get-screenshots-folder") as Promise<{
			success: boolean;
			path?: string;
			isCustom?: boolean;
			fallback?: boolean;
			error?: string;
		}>;
	},
	chooseScreenshotsFolder: () => {
		return ipcRenderer.invoke("choose-screenshots-folder") as Promise<{
			success: boolean;
			path?: string;
			isCustom?: boolean;
			canceled?: boolean;
			preferences?: {
				format: "png" | "jpeg";
				jpegQuality: number;
				openEditorAfterCapture: boolean;
				globalShortcut: string | null;
				copyToClipboard: boolean;
				captureDelayMs: 0 | 3000 | 5000;
				lastCaptureMode: "fullscreen" | "region" | "source" | null;
				fileNameTemplate: string;
				folder: string | null;
			};
			error?: string;
		}>;
	},
	openScreenshotsFolder: () => {
		return ipcRenderer.invoke("open-screenshots-folder") as Promise<{
			success: boolean;
			path?: string;
			error?: string;
		}>;
	},
	createProjectFile: (data: unknown, thumbnail?: string | null) =>
		ipcRenderer.invoke("create-project-file", data, thumbnail),
	renameLibraryProject: (path: string, name: string) =>
		ipcRenderer.invoke("rename-library-project", path, name),
	trashProjectFiles: (paths: string[]) => ipcRenderer.invoke("trash-project-files", paths),
	showProjectDashboard: () => ipcRenderer.invoke("show-project-dashboard"),
	switchToEditor: () => {
		return ipcRenderer.invoke("switch-to-editor");
	},
	openSourceSelector: () => {
		return ipcRenderer.invoke("open-source-selector");
	},
	selectSource: (source: ProcessedDesktopSource) => {
		return ipcRenderer.invoke("select-source", source);
	},
	showSourceHighlight: (source: ProcessedDesktopSource) => {
		return ipcRenderer.invoke("show-source-highlight", source);
	},
	getSelectedSource: () => {
		return ipcRenderer.invoke("get-selected-source");
	},
	onSelectedSourceChanged: (callback: (source: ProcessedDesktopSource | null) => void) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: ProcessedDesktopSource | null,
		) => callback(payload);
		ipcRenderer.on("selected-source-changed", listener);
		return () => ipcRenderer.removeListener("selected-source-changed", listener);
	},
	startNativeScreenRecording: (
		source: ProcessedDesktopSource,
		options?: {
			capturesSystemAudio?: boolean;
			capturesMicrophone?: boolean;
			microphoneDeviceId?: string;
			microphoneLabel?: string;
		},
	) => {
		return ipcRenderer.invoke("start-native-screen-recording", source, options);
	},
	stopNativeScreenRecording: () => {
		return ipcRenderer.invoke("stop-native-screen-recording");
	},
	recoverNativeScreenRecording: () => {
		return ipcRenderer.invoke("recover-native-screen-recording");
	},
	getLastNativeCaptureDiagnostics: () => {
		return ipcRenderer.invoke("get-last-native-capture-diagnostics");
	},
	pauseNativeScreenRecording: () => {
		return ipcRenderer.invoke("pause-native-screen-recording");
	},
	resumeNativeScreenRecording: () => {
		return ipcRenderer.invoke("resume-native-screen-recording");
	},
	pauseCursorCapture: (pausedAtMs?: number) => {
		return ipcRenderer.invoke("pause-cursor-capture", pausedAtMs);
	},
	resumeCursorCapture: (resumedAtMs?: number) => {
		return ipcRenderer.invoke("resume-cursor-capture", resumedAtMs);
	},
	startFfmpegRecording: (source: ProcessedDesktopSource) => {
		return ipcRenderer.invoke("start-ffmpeg-recording", source);
	},
	stopFfmpegRecording: () => {
		return ipcRenderer.invoke("stop-ffmpeg-recording");
	},
	storeRecordedVideo: (videoData: ArrayBuffer, fileName: string) => {
		return ipcRenderer.invoke("store-recorded-video", videoData, fileName);
	},
	storeMicrophoneSidecar: (
		audioData: ArrayBuffer,
		videoPath: string,
		options?: {
			startDelayMs?: number;
			browserMicrophoneProfile?: string;
			requestedBrowserMicrophoneProfile?: string | null;
			requestedConstraints?: unknown;
			mediaTrackSettings?: Record<string, boolean | number | string>;
			audioInputDevices?: Array<{
				deviceId: string;
				groupId?: string;
				label: string;
			}>;
			mediaRecorder?: {
				mimeType?: string;
				audioBitsPerSecond?: number;
				timesliceMs?: number;
			};
			chunkEvents?: Array<{
				index: number;
				size: number;
				elapsedMs: number;
				deltaMs: number | null;
			}>;
		},
	) => {
		return ipcRenderer.invoke("store-microphone-sidecar", audioData, videoPath, options);
	},
	getRecordedVideoPath: () => {
		return ipcRenderer.invoke("get-recorded-video-path");
	},
	setRecordingState: (recording: boolean) => {
		return ipcRenderer.invoke("set-recording-state", recording);
	},
	setCursorScale: (scale: number) => {
		return ipcRenderer.invoke("set-cursor-scale", scale);
	},
	getCursorTelemetry: (videoPath?: string) => {
		return ipcRenderer.invoke("get-cursor-telemetry", videoPath);
	},
	setCursorTelemetry: (videoPath: string | undefined, samples: CursorTelemetryPoint[]) => {
		return ipcRenderer.invoke("set-cursor-telemetry", videoPath, samples);
	},
	getSystemCursorAssets: () => {
		return ipcRenderer.invoke("get-system-cursor-assets");
	},
	onStopRecordingFromTray: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("stop-recording-from-tray", listener);
		return () => ipcRenderer.removeListener("stop-recording-from-tray", listener);
	},
	onRecordingStateChanged: (
		callback: (state: { recording: boolean; sourceName: string }) => void,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: { recording: boolean; sourceName: string },
		) => callback(payload);
		ipcRenderer.on("recording-state-changed", listener);
		return () => ipcRenderer.removeListener("recording-state-changed", listener);
	},
	onRecordingInterrupted: (callback: (state: { reason: string; message: string }) => void) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: { reason: string; message: string },
		) => callback(payload);
		ipcRenderer.on("recording-interrupted", listener);
		return () => ipcRenderer.removeListener("recording-interrupted", listener);
	},
	onCursorStateChanged: (
		callback: (state: { cursorType: CursorTelemetryPoint["cursorType"] }) => void,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: { cursorType: CursorTelemetryPoint["cursorType"] },
		) => callback(payload);
		ipcRenderer.on("cursor-state-changed", listener);
		return () => ipcRenderer.removeListener("cursor-state-changed", listener);
	},
	openExternalUrl: (url: string) => {
		return ipcRenderer.invoke("open-external-url", url);
	},
	getAccessibilityPermissionStatus: () => {
		return ipcRenderer.invoke("get-accessibility-permission-status");
	},
	requestAccessibilityPermission: () => {
		return ipcRenderer.invoke("request-accessibility-permission");
	},
	getScreenRecordingPermissionStatus: () => {
		return ipcRenderer.invoke("get-screen-recording-permission-status");
	},
	openScreenRecordingPreferences: () => {
		return ipcRenderer.invoke("open-screen-recording-preferences");
	},
	openAccessibilityPreferences: () => {
		return ipcRenderer.invoke("open-accessibility-preferences");
	},
	saveExportedVideo: (
		videoData: ArrayBuffer,
		fileName: string,
		captionSidecar?: {
			format: "srt" | "vtt" | "both";
			cues: Array<{
				startMs: number;
				endMs: number;
				text: string;
			}>;
		},
	) => {
		return ipcRenderer.invoke("save-exported-video", videoData, fileName, captionSidecar);
	},
	writeExportedVideoToPath: (
		videoData: ArrayBuffer,
		outputPath: string,
		captionSidecar?: {
			format: "srt" | "vtt" | "both";
			cues: Array<{
				startMs: number;
				endMs: number;
				text: string;
			}>;
		},
	) => {
		return ipcRenderer.invoke(
			"write-exported-video-to-path",
			videoData,
			outputPath,
			captionSidecar,
		);
	},
	openVideoFilePicker: (options?: { includeProjects?: boolean }) => {
		return ipcRenderer.invoke("open-video-file-picker", options);
	},
	openAudioFilePicker: () => {
		return ipcRenderer.invoke("open-audio-file-picker");
	},
	openWhisperExecutablePicker: () => {
		return ipcRenderer.invoke("open-whisper-executable-picker");
	},
	openWhisperModelPicker: () => {
		return ipcRenderer.invoke("open-whisper-model-picker");
	},
	getWhisperSmallModelStatus: () => {
		return ipcRenderer.invoke("get-whisper-small-model-status");
	},
	downloadWhisperSmallModel: () => {
		return ipcRenderer.invoke("download-whisper-small-model");
	},
	deleteWhisperSmallModel: () => {
		return ipcRenderer.invoke("delete-whisper-small-model");
	},
	onWhisperSmallModelDownloadProgress: (
		callback: (state: {
			status: "idle" | "downloading" | "downloaded" | "error";
			progress: number;
			path?: string | null;
			error?: string;
		}) => void,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: {
				status: "idle" | "downloading" | "downloaded" | "error";
				progress: number;
				path?: string | null;
				error?: string;
			},
		) => callback(payload);
		ipcRenderer.on("whisper-small-model-download-progress", listener);
		return () => ipcRenderer.removeListener("whisper-small-model-download-progress", listener);
	},
	generateAutoCaptions: (options: {
		videoPath: string;
		whisperExecutablePath?: string;
		whisperModelPath: string;
		language?: string;
	}) => {
		return ipcRenderer.invoke("generate-auto-captions", options);
	},
	setCurrentVideoPath: (
		path: string,
		options?: {
			preserveProjectPath?: boolean;
			hideOverlayCursorByDefault?: boolean;
		},
	) => {
		return ipcRenderer.invoke("set-current-video-path", path, options);
	},
	setCurrentRecordingSession: (
		session: {
			videoPath: string;
			hideOverlayCursorByDefault?: boolean;
		},
		options?: { preserveProjectPath?: boolean },
	) => {
		return ipcRenderer.invoke("set-current-recording-session", session, options);
	},
	onRecordingSessionChanged: (callback: (session: RecordingSessionData | null) => void) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: RecordingSessionData | null,
		) => callback(payload);
		ipcRenderer.on("recording-session-changed", listener);
		return () => ipcRenderer.removeListener("recording-session-changed", listener);
	},
	getCurrentRecordingSession: () => {
		return ipcRenderer.invoke("get-current-recording-session");
	},
	getCurrentVideoPath: () => {
		return ipcRenderer.invoke("get-current-video-path");
	},
	clearCurrentVideoPath: () => {
		return ipcRenderer.invoke("clear-current-video-path");
	},
	getRecordingThumbnail: (filePath: string) =>
		ipcRenderer.invoke("get-recording-thumbnail", filePath),
	finishRecordingImport: (keepPath: string, commit?: boolean) =>
		ipcRenderer.invoke("finish-recording-import", keepPath, commit),
	cancelRecordingImport: () => ipcRenderer.invoke("cancel-recording-import"),
	getProjectPreview: (projectPath: string) =>
		ipcRenderer.invoke("get-project-preview", projectPath),
	listRecordings: (includeSources?: boolean) =>
		ipcRenderer.invoke("list-recordings", includeSources),
	setRecordingsRemoved: (paths: string[], removed: boolean) =>
		ipcRenderer.invoke("set-recordings-removed", paths, removed),
	importRecording: (currentPath: string, recordingPath: string) =>
		ipcRenderer.invoke("import-recording", currentPath, recordingPath),
	deleteRecordingFile: (filePath: string) => {
		return ipcRenderer.invoke("delete-recording-file", filePath);
	},
	getLocalMediaUrl: (filePath: string) => {
		return ipcRenderer.invoke("get-local-media-url", filePath) as Promise<
			{ success: true; url: string } | { success: false }
		>;
	},
	saveProjectFile: (
		projectData: unknown,
		suggestedName?: string,
		existingProjectPath?: string,
		thumbnailDataUrl?: string | null,
	) => {
		return ipcRenderer.invoke(
			"save-project-file",
			projectData,
			suggestedName,
			existingProjectPath,
			thumbnailDataUrl,
		);
	},
	saveProjectFileNamed: (
		projectData: unknown,
		projectName: string,
		thumbnailDataUrl?: string | null,
		mode?: "rename" | "copy",
	) => {
		return ipcRenderer.invoke(
			"save-project-file-named",
			projectData,
			projectName,
			thumbnailDataUrl,
			mode,
		);
	},
	loadProjectFile: () => {
		return ipcRenderer.invoke("load-project-file");
	},
	loadCurrentProjectFile: () => {
		return ipcRenderer.invoke("load-current-project-file");
	},
	getProjectsDirectory: () => {
		return ipcRenderer.invoke("get-projects-directory");
	},
	listProjectFiles: () => {
		return ipcRenderer.invoke("list-project-files");
	},
	openProjectFileAtPath: (filePath: string) => {
		return ipcRenderer.invoke("open-project-file-at-path", filePath);
	},
	openProjectsDirectory: () => {
		return ipcRenderer.invoke("open-projects-directory");
	},
	installDownloadedUpdate: () => {
		return ipcRenderer.invoke("install-downloaded-update");
	},
	downloadAvailableUpdate: (installAfterDownload?: boolean) => {
		return ipcRenderer.invoke("download-available-update", installAfterDownload);
	},
	deferDownloadedUpdate: (delayMs?: number) => {
		return ipcRenderer.invoke("defer-downloaded-update", delayMs);
	},
	dismissUpdateToast: () => {
		return ipcRenderer.invoke("dismiss-update-toast");
	},
	skipUpdateVersion: () => {
		return ipcRenderer.invoke("skip-update-version");
	},
	getCurrentUpdateToastPayload: () => {
		return ipcRenderer.invoke("get-current-update-toast-payload");
	},
	getUpdateStatusSummary: () => {
		return ipcRenderer.invoke("get-update-status-summary");
	},
	getExperimentalUpdatesEnabled: () => {
		return ipcRenderer.invoke("get-experimental-updates-enabled");
	},
	setExperimentalUpdatesEnabled: (enabled: boolean) => {
		return ipcRenderer.invoke("set-experimental-updates-enabled", enabled);
	},
	previewUpdateToast: () => {
		return ipcRenderer.invoke("preview-update-toast");
	},
	checkForAppUpdates: () => {
		return ipcRenderer.invoke("check-for-app-updates");
	},
	onUpdateToastStateChanged: (
		callback: (
			payload: {
				version: string;
				detail: string;
				phase: "available" | "downloading" | "ready" | "error";
				delayMs: number;
				isPreview?: boolean;
				progressPercent?: number;
				transferredBytes?: number;
				totalBytes?: number;
				remainingBytes?: number;
				bytesPerSecond?: number;
				primaryAction?: "install-and-restart" | "retry-check";
			} | null,
		) => void,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: {
				version: string;
				detail: string;
				phase: "available" | "downloading" | "ready" | "error";
				delayMs: number;
				isPreview?: boolean;
				progressPercent?: number;
				transferredBytes?: number;
				totalBytes?: number;
				remainingBytes?: number;
				bytesPerSecond?: number;
				primaryAction?: "install-and-restart" | "retry-check";
			} | null,
		) => callback(payload);
		ipcRenderer.on("update-toast-state", listener);
		return () => ipcRenderer.removeListener("update-toast-state", listener);
	},
	onUpdateReadyToast: (
		callback: (payload: {
			version: string;
			detail: string;
			delayMs: number;
			isPreview?: boolean;
		}) => void,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: { version: string; detail: string; delayMs: number; isPreview?: boolean },
		) => callback(payload);
		ipcRenderer.on("update-ready-toast", listener);
		return () => ipcRenderer.removeListener("update-ready-toast", listener);
	},
	onMenuLoadProject: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-load-project", listener);
		return () => ipcRenderer.removeListener("menu-load-project", listener);
	},
	onMenuSaveProject: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-save-project", listener);
		return () => ipcRenderer.removeListener("menu-save-project", listener);
	},
	onMenuSaveProjectAs: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-save-project-as", listener);
		return () => ipcRenderer.removeListener("menu-save-project-as", listener);
	},
	getWindowChrome: () => ipcRenderer.invoke("get-window-chrome"),
	onWindowChromeChanged: (callback: (chrome: { trafficLightsVisible: boolean }) => void) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			chrome: { trafficLightsVisible: boolean },
		) => callback(chrome);
		ipcRenderer.on("window-chrome-changed", listener);
		return () => ipcRenderer.removeListener("window-chrome-changed", listener);
	},
	getPlatform: () => {
		return ipcRenderer.invoke("get-platform");
	},
	getStartupPreferences: () => {
		return ipcRenderer.invoke("get-startup-preferences");
	},
	setStartupPreferences: (patch: { openAtLogin?: boolean; startMinimized?: boolean }) => {
		return ipcRenderer.invoke("set-startup-preferences", patch);
	},
	isWindowFullscreen: () => {
		return ipcRenderer.invoke("get-window-fullscreen");
	},
	onWindowFullscreenChanged: (callback: (isFullscreen: boolean) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, isFullscreen: boolean) =>
			callback(isFullscreen);
		ipcRenderer.on("window-fullscreen-changed", listener);
		return () => ipcRenderer.removeListener("window-fullscreen-changed", listener);
	},
	getLinuxWindowSystem: () => {
		return ipcRenderer.invoke("get-linux-window-system");
	},
	revealInFolder: (filePath: string) => {
		return ipcRenderer.invoke("reveal-in-folder", filePath);
	},
	openRecordingsFolder: () => {
		return ipcRenderer.invoke("open-recordings-folder");
	},
	getRecordingsDirectory: () => {
		return ipcRenderer.invoke("get-recordings-directory");
	},
	chooseRecordingsDirectory: () => {
		return ipcRenderer.invoke("choose-recordings-directory");
	},
	getShortcuts: () => {
		return ipcRenderer.invoke("get-shortcuts");
	},
	saveShortcuts: (shortcuts: unknown) => {
		return ipcRenderer.invoke("save-shortcuts", shortcuts);
	},
	getAppSetting: (key: string) => {
		const result = ipcRenderer.sendSync("app-settings:get", key) as {
			success?: boolean;
			value?: unknown;
		};
		return result?.success ? (result.value ?? null) : null;
	},
	setAppSetting: (key: string, value: unknown) => {
		const result = ipcRenderer.sendSync("app-settings:set", key, value) as {
			success?: boolean;
		};
		return result?.success === true;
	},
	setHasUnsavedChanges: (hasChanges: boolean) => {
		ipcRenderer.send("set-has-unsaved-changes", hasChanges);
	},
	onRequestSaveBeforeClose: (callback: () => Promise<boolean>) => {
		const listener = async () => {
			let saved = false;
			try {
				saved = await callback();
			} catch {
				saved = false;
			}
			ipcRenderer.send("save-before-close-done", saved);
		};
		ipcRenderer.on("request-save-before-close", listener);
		return () => ipcRenderer.removeListener("request-save-before-close", listener);
	},
	isNativeWindowsCaptureAvailable: () =>
		ipcRenderer.invoke("is-native-windows-capture-available"),
	muxNativeWindowsRecording: (expectedDurationMs?: number) =>
		ipcRenderer.invoke("mux-native-windows-recording", expectedDurationMs),
	hideOsCursor: () => ipcRenderer.invoke("hide-cursor"),
	getAppVersion: () => ipcRenderer.invoke("app:getVersion"),
	getAnnouncements: () => ipcRenderer.invoke("announcements:get"),
	getRecordingPreferences: () => ipcRenderer.invoke("get-recording-preferences"),
	getRecordingAudioLabConfig: () => ipcRenderer.invoke("get-recording-audio-lab-config"),
	setRecordingPreferences: (prefs: {
		microphoneEnabled?: boolean;
		microphoneDeviceId?: string;
		systemAudioEnabled?: boolean;
	}) => ipcRenderer.invoke("set-recording-preferences", prefs),
	getCountdownDelay: () => ipcRenderer.invoke("get-countdown-delay"),
	setCountdownDelay: (delay: number) => ipcRenderer.invoke("set-countdown-delay", delay),
	finishRecordingStartup: () => ipcRenderer.invoke("finish-recording-startup"),
	startCountdown: (seconds: number) => ipcRenderer.invoke("start-countdown", seconds),
	cancelCountdown: () => ipcRenderer.invoke("cancel-countdown"),
	getActiveCountdown: () => ipcRenderer.invoke("get-active-countdown"),
	onCountdownTick: (callback: (seconds: number) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, seconds: number) => callback(seconds);
		ipcRenderer.on("countdown-tick", listener);
		return () => ipcRenderer.removeListener("countdown-tick", listener);
	},
});
