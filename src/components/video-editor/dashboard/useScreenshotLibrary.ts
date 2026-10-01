import { useCallback, useEffect, useState } from "react";
import type { ScreenshotLibraryEntry } from "@/types/screenshotLibrary";

/** Lists the saved screenshots folder; mirrors the shape of `useRawLibrary`. */
export function useScreenshotLibrary(enabled: boolean) {
	const [entries, setEntries] = useState<ScreenshotLibraryEntry[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const refresh = useCallback(async () => {
		setLoading(true);
		try {
			const result = await window.electronAPI.listScreenshots();
			if (!result.success) throw Error(result.error);
			setEntries(result.value);
			setError(null);
		} catch (error) {
			setError(String(error));
		} finally {
			setLoading(false);
		}
	}, []);
	useEffect(() => {
		if (enabled) void refresh();
	}, [enabled, refresh]);
	const remove = async (path: string) => {
		const result = await window.electronAPI.deleteScreenshot(path);
		if (!result.success) throw Error(result.error);
		setEntries((previous) => previous.filter((entry) => entry.path !== path));
		return path;
	};
	return { entries, error, loading, refresh, remove };
}
