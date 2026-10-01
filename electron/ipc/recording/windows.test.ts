import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setWindowsCaptureOutputBuffer, setWindowsCaptureTargetPath } from "../state";
import { stopWindowsCaptureProcess } from "./windows";

const windowsCaptureSource = readFileSync(
	fileURLToPath(new URL("../../native/wgc-capture/src/wgc_session.cpp", import.meta.url)),
	"utf8",
);

const childProcessMocks = vi.hoisted(() => ({
	execFile: vi.fn(),
}));

vi.mock("electron", () => ({
	app: {
		getPath: () => "C:\\RecordlyTest",
	},
	BrowserWindow: {
		getAllWindows: () => [],
	},
}));

vi.mock("node:child_process", () => ({
	execFile: childProcessMocks.execFile,
	spawn: vi.fn(),
}));

type WindowsCaptureProcess = Parameters<typeof stopWindowsCaptureProcess>[0];

class FakeCaptureProcess extends EventEmitter {
	stdout = new PassThrough();
	stderr = new PassThrough();
	stdin = new PassThrough();
	killed = false;
	pid = 4242;
	exitCode: number | null = null;
	signalCode: NodeJS.Signals | null = null;

	kill = vi.fn(() => {
		this.killed = true;
		return true;
	});
}

function fakeProc(): FakeCaptureProcess {
	return new FakeCaptureProcess();
}

function asProcess(proc: FakeCaptureProcess): WindowsCaptureProcess {
	return proc as unknown as WindowsCaptureProcess;
}

describe("stopWindowsCaptureProcess", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// taskkill is not available in the unit-test environment: make the tree
		// kill fall back to proc.kill() so tests stay hermetic.
		childProcessMocks.execFile.mockImplementation((...args: unknown[]) => {
			const callback = args.at(-1);
			if (typeof callback === "function") {
				(callback as (error: Error) => void)(new Error("taskkill unavailable"));
			}
		});
		setWindowsCaptureOutputBuffer("");
		setWindowsCaptureTargetPath(null);
	});

	it("sends the stop line, closes stdin and resolves the helper output path", async () => {
		const proc = fakeProc();
		const written: string[] = [];
		proc.stdin.on("data", (chunk: Buffer) => written.push(chunk.toString()));
		setWindowsCaptureOutputBuffer(
			"Recording started\nRecording stopped. Output path: C:\\Recordly\\capture.mp4",
		);

		const stopped = stopWindowsCaptureProcess(asProcess(proc), {
			graceMs: 1000,
			killWaitMs: 20,
		});

		expect(written.join("")).toBe("stop\n");
		expect(proc.stdin.writableEnded).toBe(true);

		proc.emit("exit", 0);
		proc.emit("close", 0);

		await expect(stopped).resolves.toEqual({
			outputPath: "C:\\Recordly\\capture.mp4",
			forced: false,
			timedOut: false,
			error: null,
		});
		expect(proc.kill).not.toHaveBeenCalled();
	});

	it("resolves the tracked target path when the helper exits cleanly without an output path", async () => {
		const proc = fakeProc();
		setWindowsCaptureOutputBuffer("Recording stopped without an output path");
		setWindowsCaptureTargetPath("C:\\Recordly\\fallback.mp4");

		const stopped = stopWindowsCaptureProcess(asProcess(proc), {
			graceMs: 1000,
			killWaitMs: 20,
		});
		proc.emit("close", 0);

		await expect(stopped).resolves.toEqual({
			outputPath: "C:\\Recordly\\fallback.mp4",
			forced: false,
			timedOut: false,
			error: null,
		});
		expect(proc.kill).not.toHaveBeenCalled();
	});

	it("reports helper diagnostics without killing when the helper exits non-zero", async () => {
		const proc = fakeProc();
		setWindowsCaptureOutputBuffer("Encoder error: insufficient memory");

		const stopped = stopWindowsCaptureProcess(asProcess(proc), {
			graceMs: 1000,
			killWaitMs: 20,
		});
		proc.emit("close", 1);

		await expect(stopped).resolves.toEqual({
			outputPath: null,
			forced: false,
			timedOut: false,
			error: "Encoder error: insufficient memory",
		});
		expect(proc.kill).not.toHaveBeenCalled();
	});

	it("force-terminates the helper tree and still reports the recoverable path when the budget expires", async () => {
		const proc = fakeProc();
		setWindowsCaptureTargetPath("C:\\Recordly\\recoverable.mp4");

		const startedAt = Date.now();
		const stopped = stopWindowsCaptureProcess(asProcess(proc), {
			graceMs: 20,
			killWaitMs: 20,
		});

		await expect(stopped).resolves.toEqual({
			outputPath: "C:\\Recordly\\recoverable.mp4",
			forced: true,
			timedOut: true,
			error: "Native Windows capture did not exit after being terminated",
		});

		const [taskkillBinary, taskkillArgs, taskkillOptions] = childProcessMocks.execFile.mock
			.calls[0] as unknown as [string, string[], { windowsHide?: boolean }];
		expect(childProcessMocks.execFile).toHaveBeenCalledTimes(1);
		expect(taskkillBinary).toBe("taskkill");
		expect(taskkillArgs).toEqual(["/pid", "4242", "/T", "/F"]);
		expect(taskkillOptions.windowsHide).toBe(true);
		expect(proc.kill).toHaveBeenCalledTimes(1);
		// The whole stop must stay in the seconds range, not the old 45 s budget.
		expect(Date.now() - startedAt).toBeLessThan(2000);
	});

	it("is idempotent for a helper that already exited", async () => {
		const proc = fakeProc();
		proc.exitCode = 0;
		setWindowsCaptureOutputBuffer("Recording stopped. Output path: C:\\Recordly\\done.mp4");

		await expect(
			stopWindowsCaptureProcess(asProcess(proc), { graceMs: 1000, killWaitMs: 20 }),
		).resolves.toEqual({
			outputPath: "C:\\Recordly\\done.mp4",
			forced: false,
			timedOut: false,
			error: null,
		});
		expect(proc.kill).not.toHaveBeenCalled();
		expect(childProcessMocks.execFile).not.toHaveBeenCalled();
	});

	it("never rejects when the helper stdin is already gone", async () => {
		const proc = fakeProc();
		proc.stdin.destroy();

		await expect(
			stopWindowsCaptureProcess(asProcess(proc), { graceMs: 10, killWaitMs: 10 }),
		).resolves.toMatchObject({ forced: true, timedOut: true });
	});

	it("settles on exit even when the stdio handles never close", async () => {
		const proc = fakeProc();

		const stopped = stopWindowsCaptureProcess(asProcess(proc), {
			graceMs: 500,
			killWaitMs: 20,
		});
		setWindowsCaptureOutputBuffer(
			"Recording stopped. Output path: C:\\Recordly\\exit-only.mp4",
		);
		proc.emit("exit", 0);

		await expect(stopped).resolves.toMatchObject({
			outputPath: "C:\\Recordly\\exit-only.mp4",
			forced: false,
			timedOut: false,
		});
	});
});

describe("native Windows window capture", () => {
	it("crops monitor frames to the selected window bounds", () => {
		expect(windowsCaptureSource).not.toContain("CreateForWindow(");
		expect(windowsCaptureSource).toContain("DwmGetWindowAttribute(");
		expect(windowsCaptureSource).toContain("CopySubresourceRegion(cropTexture_");
	});

	it("maps desktop bounds into WGC texture coordinates and keeps the encoder size fixed", () => {
		expect(windowsCaptureSource).toContain("normalized * framePoolWidth_");
		expect(windowsCaptureSource).toContain(
			"d3dDevice_->CreateTexture2D(&desc, nullptr, &resizedTexture)",
		);
		expect(windowsCaptureSource).not.toContain("nextWidth != captureWidth_");
	});

	it("does not expose desktop pixels when the selected window shrinks", () => {
		expect(windowsCaptureSource).toContain("(std::min)(mappedWidth");
		expect(windowsCaptureSource).toContain("ClearRenderTargetView");
	});
});
