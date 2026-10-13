import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { HIDDEN_WINDOW_OPTIONS } from "../childProcess";
import type { SelectedSource, WindowBounds } from "./types";
import { getScreen, parseWindowId } from "./utils";
import { convertPhysicalBoundsToDip } from "./windowsCaptureSelection";

const execFileAsync = promisify(execFile);

/**
 * PowerShell that restores the selected window only when it could not be
 * captured otherwise.
 *
 * Windows Graphics Capture reads a window's own content, so an occluded window
 * records perfectly well. Raising it unconditionally therefore only had one
 * effect: yanking focus away from whatever the user was doing the moment a
 * recording started. The window is raised only when it is minimized or hidden,
 * where capture would otherwise produce nothing.
 */
export function buildWindowsWindowForwardScript(): string {
	return [
		'Add-Type -TypeDefinition @"',
		"using System; using System.Runtime.InteropServices;",
		"public static class RecordlyForegroundWindow {",
		'  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);',
		'  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);',
		'  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);',
		'  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
		"}",
		'"@',
		"$handle = [IntPtr][Int64]$env:RECORDLY_WINDOW_ID",
		"$needsRaise = $false",
		"if ([RecordlyForegroundWindow]::IsIconic($handle)) {",
		"  [RecordlyForegroundWindow]::ShowWindowAsync($handle, 9) | Out-Null",
		"  $needsRaise = $true",
		"} elseif (-not [RecordlyForegroundWindow]::IsWindowVisible($handle)) {",
		"  [RecordlyForegroundWindow]::ShowWindowAsync($handle, 5) | Out-Null",
		"  $needsRaise = $true",
		"}",
		"if ($needsRaise) { [RecordlyForegroundWindow]::SetForegroundWindow($handle) | Out-Null }",
	].join("\n");
}

export async function bringWindowsWindowForward(windowId: number): Promise<void> {
	await execFileAsync(
		"powershell.exe",
		["-NoProfile", "-Command", buildWindowsWindowForwardScript()],
		{
			...HIDDEN_WINDOW_OPTIONS,
			timeout: 5000,
			env: { ...process.env, RECORDLY_WINDOW_ID: String(windowId) },
		},
	);
}

export async function resolveWindowsWindowBounds(
	source: SelectedSource,
): Promise<WindowBounds | null> {
	const windowId = parseWindowId(source.id);
	const windowTitle =
		typeof source.windowTitle === "string" ? source.windowTitle.trim() : source.name.trim();

	if (!windowId && !windowTitle) return null;

	const script = [
		"$windowId = $env:RECORDLY_WINDOW_ID",
		"$windowTitle = $env:RECORDLY_WINDOW_TITLE",
		'Add-Type -TypeDefinition @"',
		"using System;",
		"using System.Runtime.InteropServices;",
		"public static class RecordlyWindowBounds {",
		"  [StructLayout(LayoutKind.Sequential)]",
		"  public struct RECT {",
		"    public int Left;",
		"    public int Top;",
		"    public int Right;",
		"    public int Bottom;",
		"  }",
		'  [DllImport("user32.dll")]',
		"  [return: MarshalAs(UnmanagedType.Bool)]",
		"  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);",
		'  [DllImport("dwmapi.dll")]',
		"  public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out RECT rect, int size);",
		'  [DllImport("user32.dll")]',
		"  public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiContext);",
		"}",
		'"@',
		"$handle = [Int64]0",
		"if ($windowId) { $handle = [Int64]$windowId }",
		"$escapedWindowTitle = if ($windowTitle) { [WildcardPattern]::Escape($windowTitle) } else { $null }",
		"if ($handle -le 0 -and $windowTitle) {",
		'  $matchingProcess = Get-Process | Where-Object { $_.MainWindowTitle -eq $windowTitle -or ($escapedWindowTitle -and $_.MainWindowTitle -like "*$escapedWindowTitle*") } | Select-Object -First 1',
		"  if ($matchingProcess) { $handle = $matchingProcess.MainWindowHandle.ToInt64() }",
		"}",
		"if ($handle -le 0) { exit 1 }",
		"$rect = New-Object RecordlyWindowBounds+RECT",
		"[RecordlyWindowBounds]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null",
		"$dwmResult = [RecordlyWindowBounds]::DwmGetWindowAttribute([IntPtr]$handle, 9, [ref]$rect, [Runtime.InteropServices.Marshal]::SizeOf($rect))",
		"if ($dwmResult -ne 0 -and -not [RecordlyWindowBounds]::GetWindowRect([IntPtr]$handle, [ref]$rect)) { exit 1 }",
		"@{ x = $rect.Left; y = $rect.Top; width = $rect.Right - $rect.Left; height = $rect.Bottom - $rect.Top } | ConvertTo-Json -Compress",
	].join("\n");

	try {
		const { stdout } = await execFileAsync(
			"powershell.exe",
			["-NoProfile", "-Command", script],
			{
				...HIDDEN_WINDOW_OPTIONS,
				timeout: 5000,
				env: {
					...process.env,
					RECORDLY_WINDOW_ID: String(windowId ?? ""),
					RECORDLY_WINDOW_TITLE: windowTitle,
				},
			},
		);
		const bounds = JSON.parse(stdout) as WindowBounds;
		if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;

		const electronScreen = getScreen();
		return typeof electronScreen.screenToDipPoint === "function"
			? convertPhysicalBoundsToDip(bounds, (point) => electronScreen.screenToDipPoint(point))
			: bounds;
	} catch {
		return null;
	}
}
