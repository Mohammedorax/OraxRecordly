import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("HUD dividers are vertically centered", async ({ page }) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=hud-overlay");
	const dividers = page.locator(".separator--vertical");
	await expect(dividers.first()).toBeVisible();
	const offsets = await dividers.evaluateAll((elements) =>
		elements.map((element) => {
			const bounds = element.getBoundingClientRect();
			const parent = element.parentElement!.getBoundingClientRect();
			return Math.abs(bounds.y + bounds.height / 2 - parent.y - parent.height / 2);
		}),
	);
	for (const offset of offsets) expect(offset).toBeLessThanOrEqual(1);
	const home = page.getByRole("button", { name: "Home", exact: true });
	await expect(home.locator("svg")).toHaveAttribute("data-icon-style", "bold");
	await expect(page.getByRole("button", { name: "More", exact: true })).toHaveCount(0);
	const icon = await home.locator("svg").evaluate((element) => ({
		width: element.getBoundingClientRect().width,
		height: element.getBoundingClientRect().height,
	}));
	expect(icon).toEqual({ width: 20, height: 20 });
	await page.screenshot({ path: "test-results/hud-idle.png", animations: "disabled" });
	await home.click();
	await expect(page.locator("html")).toHaveAttribute("data-dashboard-opened", "true");
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("dialog", { name: "Projects dashboard" })).toBeVisible();
});

test("recording HUD uses uniform controls and a readable timer", async ({ page }) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		window.electronAPI.onRecordingStateChanged = (callback) => {
			const listener = () => callback({ recording: true, sourceName: "Built-in Display" });
			window.addEventListener("test-recording-started", listener);
			return () => window.removeEventListener("test-recording-started", listener);
		};
	});
	await page.goto("/?windowType=hud-overlay");
	await expect(page.locator(".separator--vertical").first()).toBeVisible();
	await page.evaluate(() => window.dispatchEvent(new Event("test-recording-started")));
	const controls = page.getByRole("group", { name: "Recording controls" });
	await expect(controls).toBeVisible();
	await expect(controls.getByRole("status")).toContainText("00:00");
	await expect(controls.getByRole("button", { name: "Home", exact: true })).toBeVisible();
	const sizes = await controls.getByRole("button").evaluateAll((buttons) =>
		buttons.map((button) => ({
			label: button.getAttribute("aria-label"),
			width: (button as HTMLElement).offsetWidth,
			height: (button as HTMLElement).offsetHeight,
		})),
	);
	// One capture control, not two: the screenshot button and its mode list live in
	// a single 36x36 target, and the caret that used to sit beside it is gone.
	expect(sizes.filter((button) => button.label === "Choose a capture mode")).toEqual([]);
	const capture = sizes.filter((button) => button.label === "Take screenshot");
	expect(capture).toEqual([{ label: "Take screenshot", width: 36, height: 36 }]);
	const actions = sizes.filter((button) => button.label !== "Take screenshot");
	expect(actions.length).toBeGreaterThan(0);
	for (const action of actions) {
		expect(action).toMatchObject({ width: 36, height: 36 });
	}
	await page.screenshot({ path: "test-results/hud-recording.png" });
});

test("the idle HUD offers one capture control with every mode inside it", async ({ page }) => {
	// The default bridge reports macOS, where the capture helper cannot crop a
	// drawn region yet - the option has to be absent rather than record the whole
	// screen behind the user's back.
	await installDesktopBridge(page);
	await page.goto("/?windowType=hud-overlay");
	await expect(page.locator(".separator--vertical").first()).toBeVisible();

	// Two buttons used to sit side by side (a camera and a caret); the modes are in
	// one menu now, and the separate record-a-region button no longer exists.
	const capture = page.getByRole("button", { name: "Take screenshot", exact: true });
	await expect(capture).toHaveCount(1);
	await expect(
		page.getByRole("button", { name: "Choose a capture mode", exact: true }),
	).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Record a region", exact: true })).toHaveCount(0);

	await capture.click();
	await expect(page.getByText("Capture screenshot").first()).toBeVisible();
	await expect(page.getByText(/Record a region/)).toHaveCount(0);
});

test("the capture menu offers region recording where the capture can crop", async ({ page }) => {
	// Windows is the platform whose capture helper crops every frame to the drawn
	// rectangle, so the entry belongs there.
	await installDesktopBridge(page, "preview.mp4", "win32");
	await page.goto("/?windowType=hud-overlay");

	const capture = page.getByRole("button", { name: "Take screenshot", exact: true });
	await expect(capture).toHaveCount(1);
	await capture.click();
	await expect(page.getByText(/Record a region/)).toBeVisible();
});
