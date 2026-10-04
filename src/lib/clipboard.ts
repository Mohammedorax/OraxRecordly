/**
 * Copy through Electron's native clipboard first. Toasts and error surfaces are
 * raised from windows that are not focused, where Chromium refuses
 * `navigator.clipboard` writes; the web Clipboard API remains the fallback so
 * the browser build keeps working.
 */
export async function writeClipboardText(text: string): Promise<void> {
	const bridge = typeof window === "undefined" ? undefined : window.electronAPI;
	if (typeof bridge?.writeClipboardText === "function") {
		const result = await bridge.writeClipboardText(text);
		if (result?.success) return;
		throw new Error(result?.error || "The native clipboard write failed");
	}
	await navigator.clipboard.writeText(text);
}
