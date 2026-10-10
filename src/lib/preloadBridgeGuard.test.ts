import { describe, expect, it, vi } from "vitest";
import {
	installPreloadBridgeGuard,
	isBridgeAvailable,
	PRELOAD_BRIDGE_RETRY_KEY,
	shouldRetryForMissingBridge,
} from "./preloadBridgeGuard";

type FakeWindow = {
	location: { reload: ReturnType<typeof vi.fn> };
	navigator: { userAgent: string };
	sessionStorage: {
		getItem: (key: string) => string | null;
		setItem: (k: string, v: string) => void;
	};
	electronAPI?: unknown;
};

function createFakeWindow(options: {
	userAgent?: string;
	hasBridge?: boolean;
	alreadyRetried?: boolean;
}): FakeWindow {
	const store = new Map<string, string>();
	if (options.alreadyRetried) {
		store.set(PRELOAD_BRIDGE_RETRY_KEY, "1");
	}

	const fakeWindow: FakeWindow = {
		location: { reload: vi.fn() },
		navigator: { userAgent: options.userAgent ?? "Mozilla/5.0 Electron/43.1.0" },
		sessionStorage: {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => {
				store.set(key, value);
			},
		},
	};
	if (options.hasBridge) {
		fakeWindow.electronAPI = {};
	}
	return fakeWindow;
}

describe("preload bridge guard", () => {
	it("decides when a missing bridge warrants one retry", () => {
		expect(shouldRetryForMissingBridge({ bridgeAvailable: false, alreadyRetried: false })).toBe(
			true,
		);
		expect(shouldRetryForMissingBridge({ bridgeAvailable: false, alreadyRetried: true })).toBe(
			false,
		);
		expect(shouldRetryForMissingBridge({ bridgeAvailable: true, alreadyRetried: false })).toBe(
			false,
		);
	});

	it("detects the exposed API", () => {
		expect(isBridgeAvailable({})).toBe(false);
		expect(isBridgeAvailable({ electronAPI: {} })).toBe(true);
	});

	it("reloads once when the bridge is missing in Electron", () => {
		const fakeWindow = createFakeWindow({ hasBridge: false });

		installPreloadBridgeGuard(fakeWindow as unknown as Window);

		expect(fakeWindow.location.reload).toHaveBeenCalledTimes(1);
		expect(fakeWindow.sessionStorage.getItem(PRELOAD_BRIDGE_RETRY_KEY)).toBe("1");
	});

	it("does not reload again after the retry was used", () => {
		const fakeWindow = createFakeWindow({ hasBridge: false, alreadyRetried: true });

		installPreloadBridgeGuard(fakeWindow as unknown as Window);

		expect(fakeWindow.location.reload).not.toHaveBeenCalled();
	});

	it("leaves a working bridge and plain browser sessions alone", () => {
		const healthyWindow = createFakeWindow({ hasBridge: true });
		installPreloadBridgeGuard(healthyWindow as unknown as Window);
		expect(healthyWindow.location.reload).not.toHaveBeenCalled();

		const browserWindow = createFakeWindow({
			hasBridge: false,
			userAgent: "Mozilla/5.0 Chrome/140",
		});
		installPreloadBridgeGuard(browserWindow as unknown as Window);
		expect(browserWindow.location.reload).not.toHaveBeenCalled();
	});
});
