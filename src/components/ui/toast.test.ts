import { afterEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() =>
	Object.assign(
		vi.fn(() => "toast-key"),
		{
			success: vi.fn(),
			danger: vi.fn(),
			update: vi.fn(() => "toast-key"),
			clear: vi.fn(),
			close: vi.fn(),
		},
	),
);
vi.mock("@heroui/react", () => ({ Toast: { Provider: () => null }, toast: native }));

import { toast } from "./toast";

afterEach(() => {
	toast.dismiss();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});
/** Pins the resolved locale so the localized fallbacks are deterministic. */
function stubLocale(locale: "ar" | "en") {
	vi.stubGlobal("window", {
		localStorage: {
			getItem: vi.fn(() => locale),
			setItem: vi.fn(),
			removeItem: vi.fn(),
		},
	});
}

it("copies the error title and details through the native action", async () => {
	stubLocale("en");
	const writeText = vi.fn().mockResolvedValue(undefined);
	vi.stubGlobal("navigator", { clipboard: { writeText } });
	toast.error("Export failed", { description: "Encoder unavailable" });
	const options = (
		native.mock.calls as unknown as [
			string,
			{ variant: string; actionProps: { children: string; onPress: () => void } },
		][]
	)[0][1];
	expect(options.variant).toBe("danger");
	expect(options.actionProps.children).toBe("Copy");
	options.actionProps.onPress();
	await vi.waitFor(() => expect(native.success).toHaveBeenCalledWith("Error copied"));
	expect(writeText).toHaveBeenCalledWith("Export failed\n\nEncoder unavailable");
});

it("localizes the built-in copy action to the active locale", () => {
	stubLocale("ar");
	toast.error("فشل التصدير");
	const options = (
		native.mock.calls as unknown as [string, { actionProps: { children: string } }][]
	)[0][1];
	// Arabic is the default app language, so these fallbacks must not stay English.
	expect(options.actionProps.children).toBe("نسخ");
});

/** Window stub that exposes the native clipboard bridge. */
function stubNativeBridge(writeClipboardText: ReturnType<typeof vi.fn>) {
	vi.stubGlobal("window", {
		localStorage: {
			getItem: vi.fn(() => "en"),
			setItem: vi.fn(),
			removeItem: vi.fn(),
		},
		electronAPI: { writeClipboardText },
	});
}

function lastActionOptions() {
	return (
		native.mock.calls as unknown as [string, { actionProps: { onPress: () => void } }][]
	)[0][1];
}

it("prefers the native clipboard bridge over the web API", async () => {
	const nativeWriteText = vi.fn().mockResolvedValue({ success: true });
	const webWriteText = vi.fn().mockResolvedValue(undefined);
	stubNativeBridge(nativeWriteText);
	vi.stubGlobal("navigator", { clipboard: { writeText: webWriteText } });

	toast.error("Export failed");
	lastActionOptions().actionProps.onPress();

	await vi.waitFor(() => expect(native.success).toHaveBeenCalledWith("Error copied"));
	expect(nativeWriteText).toHaveBeenCalledWith("Export failed");
	expect(webWriteText).not.toHaveBeenCalled();
});

it("surfaces a native write failure instead of masking it with the web fallback", async () => {
	const nativeWriteText = vi.fn().mockResolvedValue({ success: false, error: "denied" });
	const webWriteText = vi.fn().mockResolvedValue(undefined);
	stubNativeBridge(nativeWriteText);
	vi.stubGlobal("navigator", { clipboard: { writeText: webWriteText } });

	toast.error("Export failed");
	lastActionOptions().actionProps.onPress();

	await vi.waitFor(() => expect(native.danger).toHaveBeenCalled());
	// A bridge that exists but failed must not be papered over by the web API.
	expect(webWriteText).not.toHaveBeenCalled();
	expect(native.success).not.toHaveBeenCalled();
});
it("preserves explicit actions and updates named notifications", () => {
	const onClick = vi.fn();
	toast.error("Retry", { id: "job", action: { label: "Retry", onClick } });
	toast.success("Done", { id: "job" });
	expect(native.update).toHaveBeenCalledWith(
		"toast-key",
		"Done",
		expect.objectContaining({ variant: "success" }),
	);
	expect(native).toHaveBeenCalledWith(
		"Retry",
		expect.objectContaining({ actionProps: { children: "Retry", onPress: onClick } }),
	);
});
