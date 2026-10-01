import { clipboard, ipcMain, nativeImage } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	ipcMain: {
		handle: vi.fn(),
	},
	clipboard: {
		writeText: vi.fn(),
		writeImage: vi.fn(),
	},
	nativeImage: {
		createFromDataURL: vi.fn(),
	},
}));

import {
	registerClipboardHandlers,
	WRITE_CLIPBOARD_IMAGE_CHANNEL,
	WRITE_CLIPBOARD_TEXT_CHANNEL,
	writeClipboardImage,
	writeClipboardText,
} from "./clipboard";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

function makeFakeImage(empty = false) {
	return { isEmpty: () => empty } as unknown as Electron.NativeImage;
}

beforeEach(() => {
	vi.mocked(ipcMain.handle).mockReset();
	vi.mocked(clipboard.writeText).mockReset();
	vi.mocked(clipboard.writeImage).mockReset();
	vi.mocked(nativeImage.createFromDataURL).mockReset();
});

describe("writeClipboardText", () => {
	it("writes plain text to the native clipboard", () => {
		const result = writeClipboardText("Export failed\n\nEncoder unavailable");

		expect(result).toEqual({ success: true });
		expect(clipboard.writeText).toHaveBeenCalledTimes(1);
		expect(clipboard.writeText).toHaveBeenCalledWith("Export failed\n\nEncoder unavailable");
		expect(clipboard.writeImage).not.toHaveBeenCalled();
	});

	it("rejects a non-string payload without touching the clipboard", () => {
		const result = writeClipboardText(42 as unknown as string);

		expect(result.success).toBe(false);
		expect(result.error).toMatch(/string/i);
		expect(clipboard.writeText).not.toHaveBeenCalled();
		expect(clipboard.writeImage).not.toHaveBeenCalled();
	});

	it("reports a native write failure instead of claiming success", () => {
		vi.mocked(clipboard.writeText).mockImplementation(() => {
			throw new Error("clipboard is unavailable");
		});

		const result = writeClipboardText("hello");

		expect(result).toEqual({ success: false, error: "clipboard is unavailable" });
	});
});

describe("writeClipboardImage", () => {
	it("decodes a PNG data URL and writes the image to the native clipboard", () => {
		const image = makeFakeImage();
		vi.mocked(nativeImage.createFromDataURL).mockReturnValue(image);

		const result = writeClipboardImage(PNG_DATA_URL);

		expect(result).toEqual({ success: true });
		expect(nativeImage.createFromDataURL).toHaveBeenCalledWith(PNG_DATA_URL);
		expect(clipboard.writeImage).toHaveBeenCalledTimes(1);
		expect(clipboard.writeImage).toHaveBeenCalledWith(image);
	});

	it("rejects a data URL that decodes to an empty image without writing", () => {
		vi.mocked(nativeImage.createFromDataURL).mockReturnValue(makeFakeImage(true));

		const result = writeClipboardImage("data:image/png;base64,not-an-image");

		expect(result.success).toBe(false);
		expect(result.error).toMatch(/did not decode/i);
		expect(clipboard.writeImage).not.toHaveBeenCalled();
	});

	it("rejects an empty data URL without decoding or writing", () => {
		const result = writeClipboardImage("   ");

		expect(result.success).toBe(false);
		expect(result.error).toMatch(/data URL/i);
		expect(nativeImage.createFromDataURL).not.toHaveBeenCalled();
		expect(clipboard.writeImage).not.toHaveBeenCalled();
	});

	it("reports a decode failure instead of writing a broken image", () => {
		vi.mocked(nativeImage.createFromDataURL).mockImplementation(() => {
			throw new Error("unsupported image data");
		});

		const result = writeClipboardImage(PNG_DATA_URL);

		expect(result).toEqual({ success: false, error: "unsupported image data" });
		expect(clipboard.writeImage).not.toHaveBeenCalled();
	});
});

describe("registerClipboardHandlers", () => {
	it("registers the text and image clipboard channels", () => {
		registerClipboardHandlers();

		expect(ipcMain.handle).toHaveBeenCalledTimes(2);
		expect(ipcMain.handle).toHaveBeenCalledWith(
			WRITE_CLIPBOARD_TEXT_CHANNEL,
			expect.any(Function),
		);
		expect(ipcMain.handle).toHaveBeenCalledWith(
			WRITE_CLIPBOARD_IMAGE_CHANNEL,
			expect.any(Function),
		);
	});
});
