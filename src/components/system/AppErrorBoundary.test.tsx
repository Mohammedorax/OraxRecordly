import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadWithRetry } from "@/lib/lazyWithRetry";
import { AppErrorBoundary, ErrorFallback, reloadWindow } from "./AppErrorBoundary";

// The fallback reads its labels from the i18n context, which is not mounted in
// this static-markup test. Resolve every lookup to its English fallback so the
// assertions below stay locale-independent.
vi.mock("@/contexts/I18nContext", () => ({
	useI18n: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

beforeEach(() => {
	// The retry helper logs every failed attempt; keep the test output clean.
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("AppErrorBoundary", () => {
	it("turns a thrown error into state the fallback can render", () => {
		const error = new Error("Failed to fetch dynamically imported module");
		expect(AppErrorBoundary.getDerivedStateFromError(error)).toEqual({ error });
	});

	it("renders a visible, actionable fallback with an opaque surface", () => {
		const html = renderToStaticMarkup(
			<ErrorFallback
				error={new Error("Failed to fetch dynamically imported module")}
				windowType="hud-overlay"
				onReload={() => {}}
			/>,
		);

		expect(html).toContain("Something went wrong");
		expect(html).toContain("Reload");
		expect(html).toContain("Copy details");
		expect(html).toContain("Failed to fetch dynamically imported module");
		// The transparent overlay windows clear html/body/#root; the fallback
		// must still paint something, or the failure is invisible.
		expect(html).toContain("var(--background");
	});
});

describe("reloadWindow", () => {
	it("reloads the renderer so a rejected chunk can be retried", () => {
		const reload = vi.fn();
		vi.stubGlobal("window", { location: { reload } });

		reloadWindow();

		expect(reload).toHaveBeenCalledTimes(1);
	});
});

describe("loadWithRetry", () => {
	it("recovers from a transient import failure", async () => {
		const loaded = { default: "HudWindow" };
		const loader = vi
			.fn()
			.mockRejectedValueOnce(new Error("transient read error"))
			.mockResolvedValue(loaded);

		await expect(loadWithRetry(loader)).resolves.toBe(loaded);
		expect(loader).toHaveBeenCalledTimes(2);
	});

	it("rethrows after the final attempt so the boundary can catch it", async () => {
		const failure = new Error("chunk missing");
		const loader = vi.fn().mockRejectedValue(failure);

		await expect(loadWithRetry(loader)).rejects.toBe(failure);
		expect(loader).toHaveBeenCalledTimes(2);
	});
});
