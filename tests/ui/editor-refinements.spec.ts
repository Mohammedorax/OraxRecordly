import { expect, test, type Locator, type Page } from "@playwright/test";
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

test("populated project and preset popovers fit long names and dismiss outside", async ({
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
	const projects = page.getByRole("dialog", { name: "Projects", exact: true });
	await expect(projects.getByRole("button", { name: /A very long project name/ })).toHaveCount(5);
	await expectButtonsFit(projects);
	await page.screenshot({
		path: "test-results/editor-projects-populated.png",
		animations: "disabled",
	});
	await clickOutside(page);
	await expect(projects).toHaveCount(0);
	await page.getByRole("button", { name: "Open presets", exact: true }).click();
	const presets = page.getByRole("dialog", { name: "Presets", exact: true });
	await presets
		.getByRole("textbox", { name: "Preset name" })
		.fill("A very long saved preset name that must not push its delete button out");
	await presets.getByRole("button", { name: "Save", exact: true }).click();
	await expect(presets.getByRole("button", { name: /Delete preset/ })).toBeVisible();
	await expectButtonsFit(presets);
	await page.screenshot({
		path: "test-results/editor-presets-populated.png",
		animations: "disabled",
	});
	await clickOutside(page);
	await expect(presets).toHaveCount(0);
	await page.getByRole("button", { name: "Export", exact: true }).click();
	await expect(page.getByRole("grid", { name: "Format", exact: true })).toBeVisible();
	await clickOutside(page);
	await expect(page.getByRole("grid", { name: "Format", exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "Crop Video", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "Crop Video" })).toBeVisible();
	await page.mouse.click(20, 300);
	await expect(page.getByRole("dialog", { name: "Crop Video" })).toHaveCount(0);
});
