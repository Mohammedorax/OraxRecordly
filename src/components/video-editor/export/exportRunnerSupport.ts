import type { RefObject } from "react";
import { useCallback } from "react";
import { toast } from "@/components/ui/toast";
import { useI18n } from "@/contexts/I18nContext";
import type { SupportedMp4Dimensions } from "@/lib/exporter";
import type { useVideoEditorAudio } from "../audio/useVideoEditorAudio";
import type { getSmokeExportConfig } from "../smokeExportConfig";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useTimelineState } from "../state/useTimelineState";
import type { CursorTelemetryPoint, SpeedRegion, ZoomRegion } from "../types";
import type { VideoPlaybackRef } from "../VideoPlayback";
import { summarizeErrorMessage } from "../videoEditorUtils";
import type { PendingExportSave } from "./exportPersistence";
import type { useExportSession } from "./useExportSession";
import type { useExportSettings } from "./useExportSettings";

export type ExportRunnerInput = {
	videoPath: string | null;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	isPlaying: boolean;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	exportSettings: ReturnType<typeof useExportSettings>;
	exportSession: ReturnType<typeof useExportSession>;
	audio: ReturnType<typeof useVideoEditorAudio>;
	smokeExportConfig: ReturnType<typeof getSmokeExportConfig>;
	effectiveSpeedRegions: SpeedRegion[];
	effectiveZoomRegions: ZoomRegion[];
	effectiveCursorTelemetry: CursorTelemetryPoint[];
	effectiveShowCursor: boolean;
	ensureSupportedMp4SourceDimensions: (
		frameRate: ReturnType<typeof useExportSettings>["mp4FrameRate"],
		options?: { capTo1080p?: boolean },
	) => Promise<SupportedMp4Dimensions>;
	captionSidecarPayload?: PendingExportSave["captionSidecar"];
	experimentalNvidiaCudaExport: boolean;
	nvidiaCudaExportAvailable: boolean;
	remountPreview: () => void;
};

export function showExportErrorToast(message: string) {
	const summary = summarizeErrorMessage(message);
	toast.error(summary, {
		description: summary === message ? undefined : message,
		duration: 20_000,
	});
}

export function useExportSuccessToast() {
	const { t } = useI18n();

	return useCallback(
		(filePath: string) => {
			toast.success(
				t("editor.export.exportedTo", "Exported successfully to {{path}}", {
					path: filePath,
				}),
				{
					action: {
						label: t("dialogs.export.showInFolder", "Show in Folder"),
						onClick: async () => {
							try {
								const result = await window.electronAPI.revealInFolder(filePath);
								if (!result.success) {
									toast.error(
										result.error ||
											result.message ||
											t(
												"editor.export.failedToRevealInFolder",
												"Failed to reveal item in folder.",
											),
									);
								}
							} catch (error) {
								toast.error(
									t(
										"editor.export.revealFailedWithError",
										"Failed to reveal item in folder: {{error}}",
										{ error: String(error) },
									),
								);
							}
						},
					},
				},
			);
		},
		[t],
	);
}
