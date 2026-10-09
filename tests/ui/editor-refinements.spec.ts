import { expect, type Locator, type Page, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";
import { filmstripFrameSignatures, filmstripFrames } from "./filmstrip";

async function expectButtonsFit(container: Locator) {
	const issues = await container.evaluate((root) => {
		const bounds = root.getBoundingClientRect();
		const buttons = Array.from(root.querySelectorAll("button")).filter(
			(button) => button.getBoundingClientRect().width > 0,
		);
		return buttons.flatMap((button) => {
			const rect = button.getBoundingClientRect();
			return rect.left < bounds.left - 1 ||
				rect.right > bounds.right + 1 ||
				button.scrollWidth > button.clientWidth + 2
				? [button.textContent]
				: [];
		});
	});
	expect(issues).toEqual([]);
}
async function clickOutside(page: Page) {
	await page.mouse.click(1000, 300);
}

test("clip filmstrip decodes different source frames and zoom blocks use the available height", async ({
	page,
}) => {
	test.setTimeout(60000);
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	const frames = filmstripFrames(page.locator('[data-variant="clip"]'));
	await expect.poll(() => frames.count(), { timeout: 20000 }).toBeGreaterThan(2);
	const signatures = await filmstripFrameSignatures(frames);
	expect(new Set(signatures).size).toBeGreaterThan(2);
	await page.getByRole("button", { name: "Add Zoom (Z)", exact: true }).click();
	const zoom = page.locator('[data-timeline-item][data-variant="zoom"] .timeline-block');
	await expect(zoom).toBeVisible();
	expect((await zoom.boundingBox())!.height).toBeGreaterThan(50);
	await expect(page.locator(".timeline-axis")).toHaveCount(0);
	await page.screenshot({
		path: "test-results/editor-filmstrip-zoom.png",
		animations: "disabled",
	});
});

test("advanced controls and captions have consistent layouts", async ({ page }) => {
	test.setTimeout(60000);
	await installDesktopBridge(page);

	await page.goto("/?windowType=editor");
	await page.getByRole("radio", { name: "Cursor", exact: true }).click();
	await expect(page.getByRole("switch", { name: "Show Cursor", exact: true })).toHaveCount(0);
	await page.locator("aside").getByText("Advanced", { exact: true }).click();
	await expect(page.getByRole("switch", { name: "Show Cursor", exact: true })).toBeVisible();
	await expect(page.getByRole("switch", { name: "Loop cursor", exact: true })).toBeVisible();
	await page.getByRole("radio", { name: "Captions", exact: true }).click();
	await expect(page.getByRole("button", { name: "Select Model", exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Use custom", exact: true })).toHaveCount(0);
	await expect(page.getByRole("switch", { name: "Hover to add on timeline" })).toHaveCount(0);
	const language = await page
		.locator("aside")
		.getByText("Language", { exact: true })
		.boundingBox();
	const animation = await page
		.locator("aside")
		.getByText("Animation", { exact: true })
		.boundingBox();
	expect(animation!.y).toBeGreaterThan(language!.y);
	await expectButtonsFit(page.locator("aside"));
	await page.screenshot({
		path: "test-results/editor-captions-basic.png",
		animations: "disabled",
	});
	await page.locator("aside").getByText("Advanced", { exact: true }).click();
	await expect(page.getByRole("button", { name: "Use custom", exact: true })).toBeVisible();
});

test("populated projects dashboard fits long names and dismisses its overlays", async ({
	page,
}) => {
	test.setTimeout(60000);
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
	await page.evaluate(() => {
		window.electronAPI.listProjectFiles = async () => ({
			success: true,
			projects: [],
			entries: Array.from({ length: 5 }, (_, i) => ({
				path: `/projects/${i}.recordly`,
				name: `A very long project name with many words ${i}`,
				updatedAt: Date.now(),
				thumbnailPath: null,
				isCurrent: i === 0,
				isInProjectsDirectory: true,
			})),
		});
	});
	await page.getByRole("button", { name: "Home", exact: true }).click();
	// Home now opens the "Projects dashboard" modal, not a "Projects" popover.
	const projects = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
	await expect(projects).toBeVisible();
	const projectList = projects.getByRole("list", { name: "Your projects" });
	// Each project contributes exactly three buttons whose name contains it: the
	// card itself, "Add folder to ...", and "Options for ...".
	await expect(projects.getByRole("button", { name: /A very long project name/ })).toHaveCount(
		15,
	);
	for (let index = 0; index < 5; index += 1) {
		await expect(
			projectList.getByRole("button", {
				name: `A very long project name with many words ${index}`,
				exact: true,
			}),
		).toBeVisible();
	}
	await expectButtonsFit(projectList);
	await page.screenshot({
		path: "test-results/editor-projects-populated.png",
		animations: "disabled",
	});
	// The dashboard is a full-viewport modal, so there is no backdrop area to
	// click outside of it; Escape is its dismissal path.
	await page.keyboard.press("Escape");
	await expect(projects).toHaveCount(0);
	// The editor header no longer exposes a preset menu; Export occupies that slot.
	await expect(page.getByRole("button", { name: "Export", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Export", exact: true }).click();
	await expect(page.getByRole("grid", { name: "Format", exact: true })).toBeVisible();
	await clickOutside(page);
	await expect(page.getByRole("grid", { name: "Format", exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "Crop Video", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "Crop Video" })).toBeVisible();
	await page.mouse.click(20, 300);
	await expect(page.getByRole("dialog", { name: "Crop Video" })).toHaveCount(0);
});
