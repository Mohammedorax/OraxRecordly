/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
	interface ProcessEnv {
		/**
		 * The built directory structure
		 *
		 * ```tree
		 * ├─┬─┬ dist
		 * │ │ └── index.html
		 * │ │
		 * │ ├─┬ dist-electron
		 * │ │ ├── main.js
		 * │ │ └── preload.js
		 * │
		 * ```
		 */
		APP_ROOT: string;
		/** /dist/ or /public/ */
		VITE_PUBLIC: string;
	}
}

// Used in Renderer process, expose in `preload.ts`
interface NativeCaptureDiagnostics {
	backend: "windows-wgc" | "mac-screencapturekit" | "browser-store" | "ffmpeg";
	phase: "availability" | "start" | "stop" | "mux";
	timestamp: string;
	sourceId?: string | null;
	sourceType?: "screen" | "window" | "unknown";
	displayId?: number | null;
	displayBounds?: { x: number; y: number; width: number; height: number } | null;
	windowHandle?: number | null;
	helperPath?: string | null;
	outputPath?: string | null;
	systemAudioPath?: string | null;
	microphonePath?: string | null;
	osRelease?: string;
	supported?: boolean;
	helperExists?: boolean;
	fileSizeBytes?: number | null;
	processOutput?: string;
	error?: string;
}

interface UpdateToastState {
	version: string;
	detail: string;
	phase: "available" | "downloading" | "ready" | "error";
	delayMs: number;
	isPreview?: boolean;
	isExperimental?: boolean;
	progressPercent?: number;
	transferredBytes?: number;
	totalBytes?: number;
	remainingBytes?: number;
	bytesPerSecond?: number;
	primaryAction?: "install-and-restart" | "retry-check";
}

interface UpdateStatusSummary {
	status: "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "error";
	currentVersion: string;
	availableVersion: string | null;
	detail?: string;
}

type RendererRecordingSessionData = import("./ipc/types").RecordingSessionData;

interface RendererFfmpegAudioMuxMetrics {
	tempVideoWriteMs?: number;
	tempEditedAudioWriteMs?: number;
	ffmpegExecMs?: number;
	muxedVideoReadMs?: number;
	tempVideoBytes?: number;
	tempEditedAudioBytes?: number;
	muxedVideoBytes?: number;
}

interface RendererWindowsGpuExportSummary {
	success?: boolean;
	width?: number;
	height?: number;
	fps?: number;
	seconds?: number;
	mediaMs?: number;
	frames?: number;
	gpuDecodeSurface?: boolean;
	cursorOverlay?: boolean;
	zoomOverlay?: boolean;
	surfacePoolSize?: number;
	adapterIndex?: number;
	adapterVendorId?: number;
	adapterDeviceId?: number;
	adapterDedicatedVideoMemoryMB?: number;
	encoderBackend?: string;
	encoderTuningApplied?: boolean;
	nvencOutputBytes?: number;
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
}

interface RendererNativeStaticLayoutChunkMetric {
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
	windowsGpuSummary?: RendererWindowsGpuExportSummary;
}

interface RendererNativeStaticLayoutMetrics extends RendererFfmpegAudioMuxMetrics {
	chunkCount: number;
	chunkDurationSec: number;
	chunkExecMs: number;
	concatExecMs?: number;
	staticAssetExecMs?: number;
	fallbackChunkCount: number;
	videoOnlyBytes?: number;
	chunks: RendererNativeStaticLayoutChunkMetric[];
}

interface RendererNativeStaticLayoutProgress {
	sessionId?: string;
	backend?: RendererNativeStaticLayoutChunkMetric["backend"];
	stage?: "preparing" | "finalizing";
	elapsedMs?: number;
	averageFps?: number;
	instantFps?: number;
	intervalMs?: number;
	intervalFrames?: number;
	intervalDecodeWallMs?: number;
	intervalEncodeMs?: number;
	intervalPipelineWaitMs?: number;
	intervalCompositeMs?: number;
	intervalNvencMs?: number;
	intervalPacketWriteMs?: number;
	intervalRoiCompositeFrames?: number;
	intervalMonolithicCompositeFrames?: number;
	intervalCopyCompositeFrames?: number;
	currentFrame: number;
	totalFrames: number;
	percentage: number;
}

interface RendererNativeVideoMetadataProbe {
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
}

interface RendererNativeExportCapabilities {
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
}

interface RendererExportHardwareInfo {
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
}

interface RendererScreenshotResult {
	success: boolean;
	path?: string;
	width?: number;
	height?: number;
	error?: string;
	/** Set when the stored source was gone and the primary display was captured instead. */
	fallback?: boolean;
	/** Human-readable detail, including why a primary-display fallback was used. */
	message?: string;
	/** Set when the user dismissed a region selection; no file is written. */
	canceled?: boolean;
}

interface RendererScreenshotPreferences {
	format: "png" | "jpeg";
	jpegQuality: number;
	openEditorAfterCapture: boolean;
	globalShortcut: string | null;
	copyToClipboard: boolean;
	/** Countdown shown before a capture starts; 0 disables it. */
	captureDelayMs: 0 | 3000 | 5000;
	/** Last capture mode that finished successfully, or null before the first one. */
	lastCaptureMode: "fullscreen" | "region" | "source" | null;
	/** Template for the saved file's base name (supports the documented tokens). */
	fileNameTemplate: string;
	/** Custom screenshots folder, or null for `<recordings dir>/Screenshots`. */
	folder: string | null;
}

interface Window {
	electronAPI: {
		hudOverlaySetIgnoreMouse: (ignore: boolean) => void;
		hudOverlaySetSourceSelectionActive: (active: boolean) => void;
		hudOverlayDrag: (phase: "start" | "move" | "end", screenX: number, screenY: number) => void;
		hudOverlayHide: () => void;
		hudOverlayClose: () => void;
		getEditorMode: () => Promise<boolean>;
		onEditorModeChanged: (callback: (inEditor: boolean) => void) => () => void;
		hudOverlayRendererReady: () => void;
		getHudOverlayCaptureProtection: () => Promise<{ success: boolean; enabled: boolean }>;
		getHudOverlayMousePassthroughSupported: () => Promise<{
			success: boolean;
			supported: boolean;
		}>;
		setHudOverlayCaptureProtection: (
			enabled: boolean,
		) => Promise<{ success: boolean; enabled: boolean }>;
		getAssetBasePath: () => Promise<string | null>;
		getSources: (opts: Electron.SourcesOptions) => Promise<ProcessedDesktopSource[]>;
		showProjectDashboard: () => Promise<void>;
		switchToEditor: () => Promise<void>;
		openSourceSelector: () => Promise<void>;
		selectSource: (source: ProcessedDesktopSource) => Promise<ProcessedDesktopSource>;
		showSourceHighlight: (source: ProcessedDesktopSource) => Promise<{ success: boolean }>;
		getSelectedSource: () => Promise<ProcessedDesktopSource | null>;
		onSelectedSourceChanged: (
			callback: (source: ProcessedDesktopSource | null) => void,
		) => () => void;
		startNativeScreenRecording: (
			source: ProcessedDesktopSource,
			options?: {
				capturesSystemAudio?: boolean;
				capturesMicrophone?: boolean;
				microphoneDeviceId?: string;
				microphoneLabel?: string;
			},
		) => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
			userNotified?: boolean;
			microphoneFallbackRequired?: boolean;
		}>;
		stopNativeScreenRecording: () => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
		}>;
		recoverNativeScreenRecording: () => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
		}>;
		getLastNativeCaptureDiagnostics: () => Promise<{
			success: boolean;
			diagnostics?: NativeCaptureDiagnostics | null;
		}>;
		pauseNativeScreenRecording: () => Promise<{
			success: boolean;
			message?: string;
			error?: string;
		}>;
		resumeNativeScreenRecording: () => Promise<{
			success: boolean;
			message?: string;
			error?: string;
		}>;
		pauseCursorCapture: (pausedAtMs?: number) => Promise<{
			success: boolean;
			message?: string;
			error?: string;
		}>;
		resumeCursorCapture: (resumedAtMs?: number) => Promise<{
			success: boolean;
			message?: string;
			error?: string;
		}>;
		startFfmpegRecording: (
			source: ProcessedDesktopSource,
		) => Promise<{ success: boolean; path?: string; message?: string; error?: string }>;
		stopFfmpegRecording: () => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
		}>;
		storeRecordedVideo: (
			videoData: ArrayBuffer,
			fileName: string,
		) => Promise<{ success: boolean; path?: string; message?: string }>;
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
					recordedElapsedMs?: number;
					recordedDeltaMs?: number | null;
				}>;
				pauseIntervals?: Array<{
					startElapsedMs: number;
					endElapsedMs?: number;
					durationMs?: number;
				}>;
			},
		) => Promise<{ success: boolean; path?: string; error?: string }>;
		getRecordedVideoPath: () => Promise<{ success: boolean; path?: string; message?: string }>;
		listAssetDirectory: (relativeDir: string) => Promise<{
			success: boolean;
			files?: string[];
			error?: string;
		}>;
		readLocalFile: (
			filePath: string,
		) => Promise<{ success: boolean; data?: Uint8Array; error?: string }>;
		generateWallpaperThumbnail: (
			filePath: string,
		) => Promise<{ success: boolean; data?: Uint8Array; error?: string }>;
		/** Lazily scans the user's machine for usable background images. */
		listSystemWallpapers: () => Promise<import("./ipc/types").SystemWallpaperListResult>;
		/** Native open dialog restricted to image files. */
		pickSystemWallpaperImage: () => Promise<import("./ipc/types").SystemWallpaperPickResult>;
		probeNativeVideoMetadata: (filePath: string) => Promise<{
			success: boolean;
			metadata?: RendererNativeVideoMetadataProbe;
			error?: string;
		}>;
		getNativeExportCapabilities: () => Promise<{
			success: boolean;
			capabilities?: RendererNativeExportCapabilities;
			error?: string;
		}>;
		getExportHardwareInfo: () => Promise<{
			success: boolean;
			hardware?: RendererExportHardwareInfo;
			error?: string;
		}>;
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
		}) => Promise<{
			success: boolean;
			tempPath?: string;
			encoderName?: string;
			error?: string;
			metrics?: RendererNativeStaticLayoutMetrics;
		}>;
		nativeStaticLayoutExportCancel: (sessionId: string) => Promise<{
			success: boolean;
		}>;
		onNativeStaticLayoutExportProgress: (
			callback: (progress: RendererNativeStaticLayoutProgress) => void,
		) => () => void;
		nativeVideoExportStart: (options: {
			width: number;
			height: number;
			frameRate: number;
			bitrate: number;
			encodingMode: "fast" | "balanced" | "quality";
			inputMode?: "rawvideo" | "h264-stream";
		}) => Promise<{
			success: boolean;
			sessionId?: string;
			encoderName?: string;
			error?: string;
		}>;
		nativeVideoExportWriteFrame: (
			sessionId: string,
			frameData: Uint8Array,
		) => Promise<{ success: boolean; error?: string }>;
		nativeVideoExportWriteFrames: (
			sessionId: string,
			frameDataList: Uint8Array[],
		) => Promise<{ success: boolean; error?: string }>;
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
		) => Promise<{
			success: boolean;
			tempPath?: string;
			encoderName?: string;
			error?: string;
			metrics?: RendererFfmpegAudioMuxMetrics;
		}>;
		nativeVideoExportCancel: (
			sessionId: string,
		) => Promise<{ success: boolean; error?: string }>;
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
		) => Promise<{
			success: boolean;
			tempPath?: string;
			error?: string;
			metrics?: RendererFfmpegAudioMuxMetrics;
		}>;
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
		) => Promise<{
			success: boolean;
			tempPath?: string;
			error?: string;
			metrics?: RendererFfmpegAudioMuxMetrics;
		}>;
		openExportStream: (options?: { extension?: string }) => Promise<{
			success: boolean;
			streamId?: string;
			tempPath?: string;
			error?: string;
		}>;
		writeExportStreamChunk: (
			streamId: string,
			position: number,
			chunk: Uint8Array,
		) => Promise<{ success: boolean; error?: string }>;
		closeExportStream: (
			streamId: string,
			options?: { abort?: boolean },
		) => Promise<{
			success: boolean;
			tempPath?: string;
			bytesWritten?: number;
			error?: string;
		}>;
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
		}) => Promise<{
			success: boolean;
			path?: string;
			canceled?: boolean;
			message?: string;
			error?: string;
		}>;
		discardExportedTemp: (tempPath: string) => Promise<{ success: boolean; error?: string }>;
		getVideoAudioFallbackPaths: (videoPath: string) => Promise<{
			success: boolean;
			paths: string[];
			startDelayMsByPath?: Record<string, number>;
			error?: string;
		}>;
		setRecordingState: (recording: boolean) => Promise<void>;
		getCursorTelemetry: (videoPath?: string) => Promise<{
			success: boolean;
			samples: CursorTelemetryPoint[];
			message?: string;
			error?: string;
		}>;
		setCursorTelemetry: (
			videoPath: string | undefined,
			samples: CursorTelemetryPoint[],
		) => Promise<{
			success: boolean;
			samples: CursorTelemetryPoint[];
			message?: string;
			error?: string;
		}>;
		getSystemCursorAssets: () => Promise<{
			success: boolean;
			cursors: Record<string, SystemCursorAsset>;
			error?: string;
		}>;
		onStopRecordingFromTray: (callback: () => void) => () => void;
		onRecordingStateChanged: (
			callback: (state: { recording: boolean; sourceName: string }) => void,
		) => () => void;
		onRecordingSessionChanged: (
			callback: (session: RendererRecordingSessionData | null) => void,
		) => () => void;
		onRecordingInterrupted: (
			callback: (state: { reason: string; message: string }) => void,
		) => () => void;
		onCursorStateChanged: (
			callback: (state: { cursorType: CursorTelemetryPoint["cursorType"] }) => void,
		) => () => void;
		openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>;
		getAccessibilityPermissionStatus: () => Promise<{
			success: boolean;
			trusted: boolean;
			prompted: boolean;
			error?: string;
		}>;
		requestAccessibilityPermission: () => Promise<{
			success: boolean;
			trusted: boolean;
			prompted: boolean;
			error?: string;
		}>;
		getScreenRecordingPermissionStatus: () => Promise<{
			success: boolean;
			status: string;
			error?: string;
		}>;
		openScreenRecordingPreferences: () => Promise<{ success: boolean; error?: string }>;
		openAccessibilityPreferences: () => Promise<{ success: boolean; error?: string }>;
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
		) => Promise<{ success: boolean; path?: string; message?: string; canceled?: boolean }>;
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
		) => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
			canceled?: boolean;
		}>;
		openVideoFilePicker: (options?: { includeProjects?: boolean }) => Promise<{
			success: boolean;
			kind?: "media" | "project";
			path?: string;
			project?: unknown;
			extension?: string;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		openAudioFilePicker: () => Promise<{ success: boolean; path?: string; canceled?: boolean }>;
		openWhisperExecutablePicker: () => Promise<{
			success: boolean;
			path?: string;
			canceled?: boolean;
			error?: string;
		}>;
		openWhisperModelPicker: () => Promise<{
			success: boolean;
			path?: string;
			canceled?: boolean;
			error?: string;
		}>;
		getWhisperSmallModelStatus: () => Promise<{
			success: boolean;
			exists: boolean;
			path?: string | null;
			error?: string;
		}>;
		downloadWhisperSmallModel: () => Promise<{
			success: boolean;
			path?: string;
			alreadyDownloaded?: boolean;
			error?: string;
		}>;
		deleteWhisperSmallModel: () => Promise<{ success: boolean; error?: string }>;
		onWhisperSmallModelDownloadProgress: (
			callback: (state: {
				status: "idle" | "downloading" | "downloaded" | "error";
				progress: number;
				path?: string | null;
				error?: string;
			}) => void,
		) => () => void;
		generateAutoCaptions: (options: {
			videoPath: string;
			whisperExecutablePath?: string;
			whisperModelPath: string;
			language?: string;
		}) => Promise<{
			success: boolean;
			cues?: AutoCaptionCue[];
			message?: string;
			error?: string;
		}>;
		setCurrentVideoPath: (
			path: string,
			options?: {
				preserveProjectPath?: boolean;
				hideOverlayCursorByDefault?: boolean;
			},
		) => Promise<{ success: boolean }>;
		setCurrentRecordingSession: (
			session: {
				videoPath: string;
				hideOverlayCursorByDefault?: boolean;
			},
			options?: { preserveProjectPath?: boolean },
		) => Promise<{ success: boolean }>;
		getCurrentRecordingSession: () => Promise<{
			success: boolean;
			session?: {
				videoPath: string;
				hideOverlayCursorByDefault?: boolean;
			};
		}>;
		getCurrentVideoPath: () => Promise<{ success: boolean; path?: string }>;
		clearCurrentVideoPath: () => Promise<{ success: boolean }>;
		getRecordingThumbnail: (
			filePath: string,
		) => Promise<import("../src/types/recordingLibrary").LibraryResult<string>>;
		finishRecordingImport: (
			keepPath: string,
			commit?: boolean,
		) => Promise<{ success: boolean; error?: string }>;
		cancelRecordingImport: () => Promise<{ success: boolean }>;
		getProjectPreview: (
			projectPath: string,
		) => Promise<
			import("../src/types/recordingLibrary").LibraryResult<
				import("../src/types/projectPreview").ProjectPreviewData
			>
		>;
		listRecordings: (
			includeSources?: boolean,
		) => Promise<
			import("../src/types/recordingLibrary").LibraryResult<
				import("../src/types/recordingLibrary").RecordingLibraryEntry[]
			>
		>;
		setRecordingsRemoved: (
			paths: string[],
			removed: boolean,
		) => Promise<import("../src/types/recordingLibrary").LibraryResult<null>>;
		importRecording: (
			currentPath: string,
			recordingPath: string,
		) => Promise<
			import("../src/types/recordingLibrary").LibraryResult<
				import("../src/types/recordingLibrary").RecordingImportResult
			>
		>;
		deleteRecordingFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
		getLocalMediaUrl: (
			filePath: string,
		) => Promise<{ success: true; url: string } | { success: false }>;
		saveProjectFile: (
			projectData: unknown,
			suggestedName?: string,
			existingProjectPath?: string,
			thumbnailDataUrl?: string | null,
		) => Promise<{
			success: boolean;
			path?: string;
			projectId?: string;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		saveProjectFileNamed: (
			projectData: unknown,
			projectName: string,
			thumbnailDataUrl?: string | null,
			mode?: "rename" | "copy",
		) => Promise<{
			success: boolean;
			path?: string;
			projectId?: string;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		loadProjectFile: () => Promise<{
			success: boolean;
			path?: string;
			project?: unknown;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		loadCurrentProjectFile: () => Promise<{
			success: boolean;
			path?: string;
			project?: unknown;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		getProjectsDirectory: () => Promise<{
			success: boolean;
			path?: string;
			error?: string;
		}>;
		showRecordingHud: () => Promise<void>;
		captureScreenshot: () => Promise<RendererScreenshotResult>;
		/**
		 * Full-screen capture of the display under the cursor (or `options.displayId`)
		 * at native pixels. Does not require a selected recording source.
		 */
		captureScreenshotFullScreen: (options?: {
			displayId?: string;
		}) => Promise<RendererScreenshotResult>;
		/**
		 * Region capture: opens the selection overlay over the target display and
		 * resolves with the cropped image, or `{ success: false, canceled: true }`.
		 */
		captureScreenshotRegion: (options?: {
			displayId?: string;
		}) => Promise<RendererScreenshotResult>;
		/** Opens the image editor window for an existing image file. */
		openImageEditor: (path: string) => Promise<{ success: boolean; error?: string }>;
		/** Reads an image file as a data URL for the image editor canvas. */
		readImageFile: (
			path: string,
		) => Promise<{ success: boolean; dataUrl?: string; error?: string }>;
		/** Writes (or re-encodes) an image file from a data URL. */
		writeImageFile: (
			path: string,
			dataUrl: string,
			options?: { format?: "png" | "jpeg"; quality?: number; saveAs?: boolean },
		) => Promise<{ success: boolean; path?: string; error?: string }>;
		/**
		 * Copies text to the OS clipboard through the main process; preferred
		 * over `navigator.clipboard`, which non-focused windows cannot use.
		 */
		writeClipboardText: (text: string) => Promise<{ success: boolean; error?: string }>;
		/** Copies a PNG data URL to the OS clipboard as an image through the main process. */
		writeClipboardImage: (dataUrl: string) => Promise<{ success: boolean; error?: string }>;
		/**
		 * Region overlay: report the drawn rectangle in DIP client coordinates, or
		 * `null` to cancel (Esc / right-click). Cancelling writes no file.
		 */
		completeScreenshotRegion: (
			rect: { x: number; y: number; width: number; height: number } | null,
		) => void;
		/** @deprecated Use `completeScreenshotRegion(rect)`. */
		screenshotRegionComplete: (rect: {
			x: number;
			y: number;
			width: number;
			height: number;
		}) => void;
		/** @deprecated Use `completeScreenshotRegion(null)`. */
		screenshotRegionCancel: () => void;
		onScreenshotRegionReady: (
			callback: (payload: {
				displayId: string;
				scaleFactor: number;
				bounds: { x: number; y: number; width: number; height: number };
			}) => void,
		) => () => void;
		onImageEditorLoadImage: (callback: (payload: { filePath: string }) => void) => () => void;
		/**
		 * Lists the saved screenshots (newest first) so the dashboard can show them.
		 * Each entry carries a media-server URL that may be empty until the server
		 * is ready.
		 */
		listScreenshots: () => Promise<
			| {
					success: true;
					value: import("../src/types/screenshotLibrary").ScreenshotLibraryEntry[];
			  }
			| { success: false; error: string }
		>;
		/**
		 * Moves a screenshot to the OS trash. The path must resolve inside the
		 * screenshots folder, otherwise the call fails.
		 */
		deleteScreenshot: (
			path: string,
		) => Promise<{ success: true; value: null } | { success: false; error: string }>;
		getScreenshotPreferences: () => Promise<{
			success: boolean;
			preferences?: RendererScreenshotPreferences;
			error?: string;
		}>;
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
		}) => Promise<{
			success: boolean;
			preferences?: RendererScreenshotPreferences;
			/**
			 * `null` when the shortcut is intentionally disabled, `false` when the OS
			 * refused to register the accelerator.
			 */
			shortcutRegistered?: boolean | null;
			error?: string;
		}>;
		/** Absolute path of the folder captures are written to. */
		getScreenshotsFolder: () => Promise<{
			success: boolean;
			path?: string;
			/** True when the path is the user's custom folder. */
			isCustom?: boolean;
			/** True when a custom folder was unusable and the default is in use. */
			fallback?: boolean;
			error?: string;
		}>;
		/** Opens the native directory picker and persists the chosen folder. */
		chooseScreenshotsFolder: () => Promise<{
			success: boolean;
			path?: string;
			isCustom?: boolean;
			canceled?: boolean;
			preferences?: RendererScreenshotPreferences;
			error?: string;
		}>;
		/** Opens the screenshots folder in the OS file manager. */
		openScreenshotsFolder: () => Promise<{
			success: boolean;
			path?: string;
			error?: string;
		}>;
		createProjectFile: (
			data: unknown,
			thumbnail?: string | null,
		) => Promise<{
			success: boolean;
			path?: string;
			projectId?: string;
			message?: string;
			canceled?: boolean;
		}>;
		renameLibraryProject: (
			path: string,
			name: string,
		) => Promise<{ success: boolean; path?: string; error?: string }>;
		trashProjectFiles: (
			paths: string[],
		) => Promise<{ success: boolean; deleted: string[]; errors: string[] }>;
		listProjectFiles: () => Promise<{
			success: boolean;
			projectsDir?: string | null;
			entries: Array<{
				path: string;
				name: string;
				createdAt?: number;
				updatedAt: number;
				thumbnailPath: string | null;
				isCurrent: boolean;
				isInProjectsDirectory: boolean;
			}>;
			error?: string;
		}>;
		openProjectFileAtPath: (filePath: string) => Promise<{
			success: boolean;
			path?: string;
			project?: unknown;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		openProjectsDirectory: () => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
		}>;
		installDownloadedUpdate: () => Promise<{ success: boolean }>;
		downloadAvailableUpdate: (
			installAfterDownload?: boolean,
		) => Promise<{ success: boolean; message?: string }>;
		deferDownloadedUpdate: (delayMs?: number) => Promise<{
			success: boolean;
			message?: string;
		}>;
		dismissUpdateToast: () => Promise<{ success: boolean }>;
		skipUpdateVersion: () => Promise<{ success: boolean; message?: string }>;
		getCurrentUpdateToastPayload: () => Promise<UpdateToastState | null>;
		getUpdateStatusSummary: () => Promise<UpdateStatusSummary>;
		getExperimentalUpdatesEnabled: () => Promise<boolean>;
		setExperimentalUpdatesEnabled: (enabled: boolean) => Promise<{
			success: boolean;
			enabled: boolean;
			error?: string;
		}>;
		previewUpdateToast: () => Promise<{ success: boolean }>;
		checkForAppUpdates: () => Promise<{ success: boolean; logPath: string }>;
		onUpdateToastStateChanged: (
			callback: (payload: UpdateToastState | null) => void,
		) => () => void;
		onUpdateReadyToast: (
			callback: (payload: {
				version: string;
				detail: string;
				delayMs: number;
				isPreview?: boolean;
			}) => void,
		) => () => void;
		onMenuAbout: (callback: () => void) => () => void;
		onMenuLoadProject: (callback: () => void) => () => void;
		onMenuSaveProject: (callback: () => void) => () => void;
		onMenuSaveProjectAs: (callback: () => void) => () => void;
		getWindowChrome: () => Promise<{ trafficLightsVisible: boolean }>;
		onWindowChromeChanged: (
			callback: (chrome: { trafficLightsVisible: boolean }) => void,
		) => () => void;
		getPlatform: () => Promise<string>;
		getStartupPreferences: () => Promise<{
			success: boolean;
			/** False on Linux, where Electron cannot register a login item. */
			supported: boolean;
			openAtLogin: boolean;
			startMinimized: boolean;
			error?: string;
		}>;
		setStartupPreferences: (patch: {
			openAtLogin?: boolean;
			startMinimized?: boolean;
		}) => Promise<{
			success: boolean;
			supported: boolean;
			openAtLogin: boolean;
			startMinimized: boolean;
			error?: string;
		}>;
		isWindowFullscreen: () => Promise<boolean>;
		onWindowFullscreenChanged: (callback: (isFullscreen: boolean) => void) => () => void;
		getLinuxWindowSystem: () => Promise<"wayland" | "x11" | null>;
		revealInFolder: (
			filePath: string,
		) => Promise<{ success: boolean; error?: string; message?: string }>;
		openRecordingsFolder: () => Promise<{ success: boolean; error?: string; message?: string }>;
		getRecordingsDirectory: () => Promise<{
			success: boolean;
			path: string;
			isDefault: boolean;
			error?: string;
		}>;
		chooseRecordingsDirectory: () => Promise<{
			success: boolean;
			canceled?: boolean;
			path?: string;
			isDefault?: boolean;
			message?: string;
			error?: string;
		}>;
		getShortcuts: () => Promise<Record<string, unknown> | null>;
		saveShortcuts: (shortcuts: unknown) => Promise<{ success: boolean; error?: string }>;
		getAppSetting: (key: string) => unknown;
		setAppSetting: (key: string, value: unknown) => boolean;
		setHasUnsavedChanges: (hasChanges: boolean) => void;
		onRequestSaveBeforeClose: (callback: () => Promise<boolean>) => () => void;
		isNativeWindowsCaptureAvailable: () => Promise<{ available: boolean }>;
		muxNativeWindowsRecording: (expectedDurationMs?: number) => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
		}>;
		/** Returns the app version from package.json */
		getAppVersion: () => Promise<string>;
		/** Returns the configured remote announcement feed, or null when unavailable. */
		getAnnouncements: () => Promise<unknown | null>;
		/** Hide the OS cursor before browser capture starts. */
		hideOsCursor: () => Promise<{ success: boolean }>;
		/** Recording preferences (mic, system audio) */
		getRecordingPreferences: () => Promise<{
			success: boolean;
			microphoneEnabled: boolean;
			microphoneDeviceId?: string;
			systemAudioEnabled: boolean;
		}>;
		getRecordingAudioLabConfig: () => Promise<{
			browserMicrophoneProfile: string;
			requestedBrowserMicrophoneProfile: string | null;
		}>;
		setRecordingPreferences: (prefs: {
			microphoneEnabled?: boolean;
			microphoneDeviceId?: string;
			systemAudioEnabled?: boolean;
		}) => Promise<{ success: boolean; error?: string }>;
		/** Countdown timer before recording */
		getCountdownDelay: () => Promise<{ success: boolean; delay: number }>;
		setCountdownDelay: (delay: number) => Promise<{ success: boolean; error?: string }>;
		finishRecordingStartup: () => Promise<void>;
		startCountdown: (seconds: number) => Promise<{ success: boolean; cancelled?: boolean }>;
		cancelCountdown: () => Promise<{ success: boolean }>;
		getActiveCountdown: () => Promise<{ success: boolean; seconds: number | null }>;
		onCountdownTick: (callback: (seconds: number) => void) => () => void;
	};
}

interface ProcessedDesktopSource {
	id: string;
	name: string;
	display_id: string;
	thumbnail: string | null;
	appIcon: string | null;
	originalName?: string;
	sourceType?: "screen" | "window";
	appName?: string;
	windowTitle?: string;
}

interface CursorTelemetryPoint {
	timeMs: number;
	cx: number;
	cy: number;
	pressure?: number;
	interactionType?:
		| "move"
		| "click"
		| "double-click"
		| "right-click"
		| "middle-click"
		| "mouseup";
	cursorType?:
		| "arrow"
		| "text"
		| "pointer"
		| "crosshair"
		| "open-hand"
		| "closed-hand"
		| "resize-ew"
		| "resize-ns"
		| "not-allowed";
}

interface SystemCursorAsset {
	dataUrl: string;
	hotspotX: number;
	hotspotY: number;
	width: number;
	height: number;
}

interface AutoCaptionCue {
	id: string;
	startMs: number;
	endMs: number;
	text: string;
	words?: Array<{
		text: string;
		startMs: number;
		endMs: number;
		leadingSpace?: boolean;
	}>;
}
