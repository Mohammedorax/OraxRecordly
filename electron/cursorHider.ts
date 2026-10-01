import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";

const PY_HIDE_WIN = `
import ctypes, sys

class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]

class CURSORINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", ctypes.c_uint),
        ("flags", ctypes.c_uint),
        ("hCursor", ctypes.c_void_p),
        ("ptScreenPos", POINT),
    ]

user32 = ctypes.windll.user32
CURSOR_SHOWING = 0x00000001

for _ in range(32):
    info = CURSORINFO()
    info.cbSize = ctypes.sizeof(CURSORINFO)
    if user32.GetCursorInfo(ctypes.byref(info)) and not (info.flags & CURSOR_SHOWING):
        sys.exit(0)
    user32.ShowCursor(False)

sys.exit(0)
`.trim();

const PY_SHOW_WIN = `
import ctypes, sys

class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]

class CURSORINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", ctypes.c_uint),
        ("flags", ctypes.c_uint),
        ("hCursor", ctypes.c_void_p),
        ("ptScreenPos", POINT),
    ]

user32 = ctypes.windll.user32
CURSOR_SHOWING = 0x00000001

for _ in range(32):
    info = CURSORINFO()
    info.cbSize = ctypes.sizeof(CURSORINFO)
    if user32.GetCursorInfo(ctypes.byref(info)) and (info.flags & CURSOR_SHOWING):
        sys.exit(0)
    user32.ShowCursor(True)

sys.exit(0)
`.trim();

function getPowerShellCommand(show: boolean) {
	const desiredFlag = show ? 1 : 0;
	const showLiteral = show ? "$true" : "$false";

	return [
		'$signature = @"',
		"using System;",
		"using System.Runtime.InteropServices;",
		"public struct POINT { public int X; public int Y; }",
		"public struct CURSORINFO { public int cbSize; public int flags; public IntPtr hCursor; public POINT ptScreenPos; }",
		"public static class CursorNative {",
		'  [DllImport("user32.dll")] public static extern int ShowCursor(bool show);',
		'  [DllImport("user32.dll")] public static extern bool GetCursorInfo(ref CURSORINFO info);',
		"}",
		'"@;',
		"Add-Type -TypeDefinition $signature -Language CSharp -ErrorAction SilentlyContinue | Out-Null;",
		"$info = New-Object CURSORINFO;",
		"$info.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type]CURSORINFO);",
		"for ($i = 0; $i -lt 32; $i++) {",
		"  if ([CursorNative]::GetCursorInfo([ref]$info) -and (($info.flags -band 1) -eq " +
			desiredFlag +
			")) { exit 0 }",
		"  [CursorNative]::ShowCursor(" + showLiteral + ") | Out-Null;",
		"}",
		"exit 0",
	].join(" ");
}

function runCommand(executable: string, args: string[], timeoutMs: number): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		let settled = false;
		let timer: NodeJS.Timeout | null = null;

		const finish = (result: boolean) => {
			if (settled) {
				return;
			}
			settled = true;
			if (timer) {
				clearTimeout(timer);
			}
			resolve(result);
		};

		let child: ChildProcess;
		try {
			// Async spawn keeps the main process responsive; the previous
			// spawnSync variant blocked every window for up to 13s per call.
			child = spawn(executable, args, { stdio: "ignore", windowsHide: true });
		} catch {
			resolve(false);
			return;
		}

		timer = setTimeout(() => {
			try {
				child.kill();
			} catch {
				// The child may already be gone; the timeout still counts as a failure.
			}
			finish(false);
		}, timeoutMs);

		child.once("error", () => finish(false));
		child.once("close", (code) => finish(code === 0));
	});
}

async function runPythonSnippet(code: string) {
	for (const executable of ["python", "python3", "py"]) {
		if (await runCommand(executable, ["-c", code], 5000)) {
			return true;
		}
	}

	return false;
}

function runPowerShellSnippet(command: string) {
	return runCommand(
		"powershell.exe",
		["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", command],
		8000,
	);
}

let cursorHidden = false;
let cursorCommandChain: Promise<unknown> = Promise.resolve();

function enqueueCursorCommand<T>(command: () => Promise<T>): Promise<T> {
	// Cursor hide/show no longer block, so serialise them to preserve the strict
	// ordering the previous synchronous implementation guaranteed: a fast
	// stop/start must not let a queued show overtake a pending hide.
	const result = cursorCommandChain.then(command, command);
	cursorCommandChain = result.then(
		() => undefined,
		() => undefined,
	);
	return result;
}

export function hideCursor() {
	return enqueueCursorCommand(async () => {
		if (process.platform !== "win32" || cursorHidden) {
			return false;
		}

		try {
			const didHide =
				(await runPythonSnippet(PY_HIDE_WIN)) ||
				(await runPowerShellSnippet(getPowerShellCommand(false)));

			if (didHide) {
				cursorHidden = true;
			}

			return didHide;
		} catch (error) {
			console.error("[cursorHider] Failed to hide Windows cursor:", error);
			return false;
		}
	});
}

export function showCursor() {
	return enqueueCursorCommand(async () => {
		if (process.platform !== "win32" || !cursorHidden) {
			return false;
		}

		try {
			const didShow =
				(await runPythonSnippet(PY_SHOW_WIN)) ||
				(await runPowerShellSnippet(getPowerShellCommand(true)));
			if (didShow) {
				cursorHidden = false;
			}
			return didShow;
		} catch (error) {
			console.error("[cursorHider] Failed to show Windows cursor:", error);
			return false;
		}
	});
}
