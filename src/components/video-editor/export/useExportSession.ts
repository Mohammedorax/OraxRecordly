import { useCallback, useRef, useState } from "react";
import type { ExportProgress } from "@/lib/exporter";
import { resolveSavingExportProgress } from "../exportProgressState";
import type { PendingExportSave } from "./exportPersistence";

export type CancelableExporter = { cancel(): void };

export function useExportSession() {
	const [isExporting, setIsExporting] = useState(false);
	const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
	const [exportError, setExportError] = useState<string | null>(null);
	const [showExportDropdown, setShowExportDropdown] = useState(false);
	const [exportedFilePath, setExportedFilePath] = useState<string>();
	/**
	 * A plain-text summary of the last export (where the time went, which encoder
	 * ran). Kept so the user can paste it into a message instead of describing what
	 * felt slow.
	 */
	const [lastExportReport, setLastExportReport] = useState<string | null>(null);
	const [hasPendingExportSave, setHasPendingExportSave] = useState(false);
	const exporterRef = useRef<CancelableExporter | null>(null);
	const exportRunIdRef = useRef(0);
	const cancelledExportRunIdRef = useRef<number | null>(null);
	const pendingExportSaveRef = useRef<PendingExportSave | null>(null);

	const clearPendingExportSave = useCallback(() => {
		const pendingSave = pendingExportSaveRef.current;
		pendingExportSaveRef.current = null;
		setHasPendingExportSave(false);
		if (pendingSave?.tempFilePath && typeof window !== "undefined") {
			void window.electronAPI.discardExportedTemp?.(pendingSave.tempFilePath);
		}
	}, []);

	const markExportAsSaving = useCallback(() => {
		setExportProgress(resolveSavingExportProgress);
	}, []);

	return {
		isExporting,
		setIsExporting,
		exportProgress,
		setExportProgress,
		exportError,
		setExportError,
		showExportDropdown,
		setShowExportDropdown,
		exportedFilePath,
		setExportedFilePath,
		lastExportReport,
		setLastExportReport,
		hasPendingExportSave,
		setHasPendingExportSave,
		exporterRef,
		exportRunIdRef,
		cancelledExportRunIdRef,
		pendingExportSaveRef,
		clearPendingExportSave,
		markExportAsSaving,
	};
}
