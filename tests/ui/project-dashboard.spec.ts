import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { hasFreshProjectThumbnail } from "../../electron/ipc/project/thumbnailFreshness";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("home dashboard searches, sorts, opens projects and returns to the editor", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		const entries = [
			{
				path: "/projects/launch.recordly",
				name: "Launch video",
				updatedAt: 1758000000000,
				thumbnailPath: null,
				isCurrent: true,
				isInProjectsDirectory: true,
			},
			{
				path: "/projects/demo.recordly",
				name: "App walkthrough",
				updatedAt: 1759000000000,
				thumbnailPath: `${location.origin}/tests/ui/fixtures/recording-thumbnail.jpg`,
				isCurrent: false,
				isInProjectsDirectory: true,
			},
			{
				path: "/projects/tutorial.recordly",
				name: "Getting started",
				updatedAt: 1757000000000,
				thumbnailPath: null,
				isCurrent: false,
				isInProjectsDirectory: true,
			},
		];
		window.electronAPI.listProjectFiles = async () => ({
			success: true,
			projects: [],
			entries,
		});
		window.electronAPI.openProjectFileAtPath = async (path) => {
			document.documentElement.dataset.openedProject = path;
			return { success: false, canceled: true };
		};
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const home = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
	await expect(home).toBeVisible();
	const cards = home.getByRole("list", { name: "Your projects" }).locator("li > button");
	await expect(cards).toHaveCount(3);
	await expect(cards.first()).toHaveAccessibleName("App walkthrough");
	await home.getByRole("button", { name: "Sort projects" }).click();
	await page.getByRole("menuitem", { name: "Name", exact: true }).click();
	await expect(cards.nth(1)).toHaveAccessibleName("Getting started");
	const normalCardWidth = (await cards.first().boundingBox())!.width;
	await home.getByRole("textbox", { name: "Search projects" }).fill("launch");
	await expect(cards).toHaveCount(1);
	expect(Math.abs((await cards.first().boundingBox())!.width - normalCardWidth)).toBeLessThan(1);
	await home.getByRole("textbox", { name: "Search projects" }).fill("missing");
	await expect(home.getByText("No matching projects")).toBeVisible();
	await home.getByRole("button", { name: "Clear search" }).click();
	await home.getByRole("button", { name: "App walkthrough", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "Project details" })).toHaveCount(0);
	await expect(page.locator("html")).toHaveAttribute(
		"data-opened-project",
		"/projects/demo.recordly",
	);
	await expect(home).toBeVisible();
	await home.getByRole("button", { name: "New folder", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "New folder", exact: true })).toHaveCount(0);
	await home.getByRole("button", { name: "Untitled folder", exact: true }).dblclick();
	await home.getByRole("textbox", { name: "Folder name" }).fill("Tutorials");
	await page.keyboard.press("Enter");
	await home.getByRole("button", { name: "Change color for Tutorials", exact: true }).click();
	await page.getByRole("textbox", { name: "Hex color", exact: true }).fill("#123abc");
	await page.keyboard.press("Tab");
	await page.getByRole("button", { name: "Save custom color", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Remove custom color", exact: true }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await home.getByRole("button", { name: "Home", exact: true }).click();
	await home.getByRole("button", { name: "Options for App walkthrough", exact: true }).click();
	await expect(page.getByRole("menuitem", { name: "No folder", exact: true })).toHaveCount(0);
	await page.keyboard.press("Escape");
	await home.getByRole("button", { name: "Add folder to App walkthrough", exact: true }).click();
	await page.getByRole("menuitem", { name: "Tutorials", exact: true }).click();
	await expect(
		home.getByRole("button", { name: "Remove App walkthrough from Tutorials", exact: true }),
	).toContainText("Tutorials");
	await home.getByRole("button", { name: "Tutorials", exact: true }).click();
	await expect(cards).toHaveCount(1);
	await expect(cards.first()).toHaveAccessibleName("App walkthrough");
	await home.getByRole("button", { name: "Home", exact: true }).click();
	await home.getByRole("button", { name: "Last 7 days", exact: true }).click();
	await expect(cards).toHaveCount(0);
	await home.getByRole("button", { name: "All", exact: true }).click();
	await expect(cards).toHaveCount(3);
	await home.getByRole("button", { name: "Settings", exact: true }).click();
	await expect(home.getByRole("region", { name: "Dashboard settings" })).toBeVisible();
	await home.getByRole("button", { name: "Home", exact: true }).click();
	await home
		.getByRole("complementary", { name: "Library navigation" })
		.getByRole("button", { name: "Record new", exact: true })
		.click();
	await expect(page.locator("html")).toHaveAttribute("data-hud-opened", "true");
	await home.getByRole("button", { name: "Select projects to delete" }).click();
	await cards.first().click();
	await expect(cards.first()).toHaveAttribute("aria-pressed", "true");
	await home.getByRole("button", { name: "Delete", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "Delete 1 project?" })).toBeVisible();
	await page
		.getByRole("dialog", { name: "Delete 1 project?" })
		.getByRole("button", { name: "Cancel", exact: true })
		.click();
	await home.getByRole("button", { name: "Cancel", exact: true }).click();
	await page.screenshot({ path: "test-results/project-dashboard.png", animations: "disabled" });
	await page.evaluate(() => document.documentElement.classList.add("dark"));
	await page.screenshot({
		path: "test-results/project-dashboard-dark.png",
		animations: "disabled",
	});
	await page.evaluate(() => document.documentElement.classList.remove("dark"));
	await page.setViewportSize({ width: 800, height: 800 });
	await expect(home.getByRole("button", { name: "Import", exact: true })).toBeInViewport();
	await page.screenshot({
		path: "test-results/project-dashboard-compact.png",
		animations: "disabled",
	});
	await home.getByRole("button", { name: "Launch video", exact: true }).click();
	await expect(home).not.toBeVisible();
	await expect(page.getByRole("button", { name: "Rename project" })).toBeVisible();
});

test("home dashboard explains an empty library", async ({ page }) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	await expect(page.getByText("It's looking empty in here...")).toBeVisible();
	await expect(page.getByRole("button", { name: "Record new", exact: true })).toHaveCount(1);
	await page.getByRole("button", { name: "Record your first video", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-hud-opened", "true");
	await page.evaluate(() => {
		delete document.documentElement.dataset.hudOpened;
	});
	await page
		.getByRole("complementary", { name: "Library navigation" })
		.getByRole("button", { name: "Record new", exact: true })
		.click();
	await expect(page.locator("html")).toHaveAttribute("data-hud-opened", "true");
	await page.screenshot({ path: "test-results/dashboard-empty.png", animations: "disabled" });
	await expect(page.getByRole("button", { name: "Back to editor" })).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(page.getByRole("button", { name: "Rename project" })).toBeVisible();
});

test("autosave creates one untitled project, stays idle without edits, and refreshes its preview on exit without a saved toast", async ({
	page,
}, testInfo) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		const save = window.electronAPI.saveProjectFile;
		window.electronAPI.saveProjectFile = async (...args) => {
			const result = await save(...args);
			if (args[3]) document.documentElement.dataset.savedThumbnail = args[3];
			return result;
		};
		window.electronAPI.listProjectFiles = async () => ({
			success: true,
			projects: [],
			entries: [
				{
					path: "/projects/preview.recordly",
					name: "Generated preview",
					updatedAt: 1,
					thumbnailPath: document.documentElement.dataset.savedThumbnail ?? null,
					isCurrent: true,
					isInProjectsDirectory: true,
				},
			],
		});
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator("html")).toHaveAttribute("data-project-creates", "1");
	await expect(page.getByRole("button", { name: "Rename project" })).toContainText(
		"Untitled Project",
	);
	// The first autosave is debounced, so it can land after the project is created.
	// Wait for it to actually happen before snapshotting the baseline, otherwise the
	// idle window below would compare against a still-pending save.
	await expect.poll(() => page.locator("html").getAttribute("data-project-saves")).not.toBeNull();
	const before = await page.locator("html").getAttribute("data-project-saves");
	// Observe more than two debounce periods: idle must not perform periodic saves.
	await page.waitForTimeout(1800);
	await expect(page.locator("html")).toHaveAttribute("data-project-creates", "1");
	expect(await page.locator("html").getAttribute("data-project-saves")).toBe(before);
	await page.getByRole("button", { name: "Home", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "Projects dashboard" })).toBeVisible();
	await expect(page.locator("html")).toHaveAttribute(
		"data-saved-thumbnail",
		/^data:image\/png;base64,/,
	);
	const thumbnail = await page.locator("html").getAttribute("data-saved-thumbnail");
	const file = testInfo.outputPath("generated-preview.png");
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, Buffer.from(thumbnail!.split(",")[1], "base64"));
	// Exercise the actual main-process acceptance check against renderer output.
	expect(await hasFreshProjectThumbnail(file, 0)).toBe(true);
	const image = page
		.getByRole("button", { name: "Generated preview", exact: true })
		.locator("img");
	await expect(image).toBeVisible();
	await expect
		.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
		.toBe(640);
	await expect(page.getByText(/Project saved/)).toHaveCount(0);
});

test("deletion refreshes the grid and keeps unselected projects", async ({ page }) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		let entries = ["Keep", "Delete"].map((name) => ({
			path: `/projects/${name}.recordly`,
			name,
			updatedAt: Date.now(),
			thumbnailPath: null,
			isCurrent: false,
			isInProjectsDirectory: true,
		}));
		window.electronAPI.listProjectFiles = async () => ({ success: true, entries });
		window.electronAPI.trashProjectFiles = async (paths) => {
			entries = entries.filter((e) => !paths.includes(e.path));
			return { success: true, deleted: paths, errors: [] };
		};
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	await home.getByRole("button", { name: "Select projects to delete" }).click();
	await home.getByRole("list").getByRole("button", { name: "Delete", exact: true }).click();
	await home
		.getByRole("button", { name: "Delete", exact: true })
		.filter({ hasNot: page.locator("img") })
		.first()
		.click();
	await page
		.getByRole("dialog", { name: "Delete 1 project?" })
		.getByRole("button", { name: "Move to Trash" })
		.click();
	await expect(
		home.getByRole("list").getByRole("button", { name: "Delete", exact: true }),
	).toHaveCount(0);
	await expect(home.getByRole("button", { name: "Keep", exact: true })).toBeVisible();
});

test("cards rename inline and preserve folder chips", async ({ page }) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		let entry = {
			path: "/projects/demo.recordly",
			name: "Demo",
			updatedAt: Date.now(),
			thumbnailPath: null,
			isCurrent: false,
			isInProjectsDirectory: true,
		};
		localStorage.setItem(
			"recordly.project-folders.v1",
			JSON.stringify([{ id: "folder", name: "Work", color: "#123abc", paths: [entry.path] }]),
		);
		window.electronAPI.listProjectFiles = async () => ({ success: true, entries: [entry] });
		window.electronAPI.renameLibraryProject = async (_path, name) => {
			entry = { ...entry, path: `/projects/${name}.recordly`, name };
			return { success: true, path: entry.path };
		};
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	await expect(home.getByRole("button", { name: "Remove Demo from Work" })).toContainText("Work");
	await home.getByRole("button", { name: "Options for Demo" }).click();
	await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
	await home.getByRole("textbox", { name: "Project name" }).fill("Renamed");
	await page.keyboard.press("Enter");
	await expect(home.getByRole("button", { name: "Renamed", exact: true })).toBeVisible();
	await expect(home.getByRole("button", { name: "Remove Renamed from Work" })).toContainText(
		"Work",
	);
});

test("dashboard supports creation sort, independent folders and shared settings", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		localStorage.setItem(
			"recordly.project-folders.v1",
			JSON.stringify([
				{ id: "one", name: "Work", color: "#123abc", paths: ["/old.recordly"] },
				{ id: "two", name: "Personal", color: "#123abc", paths: [] },
			]),
		);
		window.electronAPI.listProjectFiles = async () => ({
			success: true,
			entries: [
				{
					path: "/old.recordly",
					name: "Old",
					updatedAt: 300,
					createdAt: 100,
					thumbnailPath: null,
					isCurrent: false,
					isInProjectsDirectory: true,
				},
				{
					path: "/new.recordly",
					name: "Newer",
					updatedAt: 200,
					createdAt: 200,
					thumbnailPath: null,
					isCurrent: false,
					isInProjectsDirectory: true,
				},
			],
		});
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Clips", exact: true }).click();
	await expect(page.getByRole("complementary", { name: "Clips" })).toBeVisible();
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	await expect(home.getByLabel("Announcements", { exact: true })).toHaveCount(0);
	await home.getByRole("button", { name: "Sort projects" }).click();
	await page.getByRole("menuitem", { name: "Last created", exact: true }).click();
	await expect(
		home.getByRole("list", { name: "Your projects" }).locator("li > button").first(),
	).toHaveAccessibleName("Newer");
	await home.getByRole("button", { name: "Add folder to Old" }).click();
	await page.getByRole("menuitem", { name: "Personal", exact: true }).click();
	await expect(home.getByRole("button", { name: "Remove Old from Work" })).toBeVisible();
	await expect(home.getByRole("button", { name: "Remove Old from Personal" })).toBeVisible();
	await expect(home.locator('[aria-label="1 more folders: Personal"]')).toHaveCount(0);
	const membership = await page.evaluate(() =>
		JSON.parse(localStorage.getItem("recordly.project-folders.v1") || "[]"),
	);
	expect(
		membership.every((folder: { paths: string[] }) => folder.paths.includes("/old.recordly")),
	).toBe(true);
	await home.getByRole("button", { name: "Settings", exact: true }).click();
	await expect(home.getByRole("textbox", { name: "Search projects" })).toHaveCount(0);
	await expect(home.getByRole("button", { name: "Sort projects" })).toHaveCount(0);
	await expect(home.getByRole("row", { name: "Dark", exact: true })).toBeVisible();
	await expect(home.getByRole("grid", { name: "Settings sections" })).toHaveCount(1);
	await expect(home.getByRole("switch", { name: "Connect Zooms" })).toHaveCount(0);
	await home.getByRole("row", { name: "Advanced", exact: true }).click();
	await expect(home.getByRole("switch", { name: "Experimental updates" })).toBeVisible();
	await expect(home.getByText("Preview update UI", { exact: true })).toBeVisible();
	await home.getByRole("row", { name: "Motion", exact: true }).click();
	await expect(home.getByRole("switch", { name: "Connect Zooms" })).toBeVisible();
	const motion = home.getByRole("region", { name: "Motion settings", exact: true });
	const label = await motion.getByText("Connect Zooms", { exact: true }).boundingBox();
	const description = await motion
		.getByText("Smooth consecutive zoom regions into a continuous camera move.", {
			exact: true,
		})
		.boundingBox();
	expect(description!.y - (label!.y + label!.height)).toBeGreaterThanOrEqual(3);
	expect(description!.x).toBe(label!.x);
	await page.screenshot({ path: "test-results/settings-motion.png", animations: "disabled" });
	await home.getByRole("row", { name: "Recording", exact: true }).click();
	await expect(home.getByText("Recordings folder", { exact: true })).toBeVisible();
	await home.getByRole("button", { name: "Change folder" }).click();
	await expect(home.getByText("/new-recordings", { exact: true })).toBeVisible();
	const capture = home.getByRole("switch", { name: "Hide HUD from recordings" });
	await capture.press("Space");
	await expect(page.locator("html")).toHaveAttribute("data-hide-hud", "true");
	await home.getByRole("row", { name: "Files", exact: true }).click();
	await expect(home.getByRole("button", { name: "Open file", exact: true })).toBeVisible();
	await home.getByRole("row", { name: "Recording", exact: true }).click();
	await expect(home.getByText("/new-recordings", { exact: true })).toBeVisible();
	await home.getByRole("row", { name: "General", exact: true }).click();
	await expect(home.getByRole("row", { name: "Dark", exact: true })).toBeVisible();
	await page.screenshot({ path: "test-results/dashboard-settings.png", animations: "disabled" });
});

test("Solar navigation selection, circular initials, and Raw sources are consistent", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		window.electronAPI.listRecordings = async (includeSources) => ({
			success: true,
			value: (includeSources ? ["screen.mp4", "screen.mic.wav"] : ["screen.mp4"]).map(
				(name) => ({
					path: `/recordings/${name}`,
					name,
					createdAt: Date.now(),
					bytes: 1048576,
					url: `${location.origin}/tests/ui/fixtures/preview.mp4`,
				}),
			),
		});
		window.electronAPI.revealInFolder = async (path) => {
			document.documentElement.dataset.revealed = path;
			return { success: true };
		};
		window.electronAPI.getRecordingThumbnail = async () => ({
			success: true,
			value: `${location.origin}/tests/ui/fixtures/recording-thumbnail.jpg`,
		});
	});
	await page.goto("/?windowType=editor");
	const scene = page.getByRole("radio", { name: "Scene", exact: true });
	const videos = page.getByRole("button", { name: "Clips", exact: true });
	await expect(page.getByRole("radio", { name: "Clips", exact: true })).toHaveCount(0);
	await expect(scene).toBeChecked();
	await expect(scene.locator("svg")).toHaveAttribute("data-icon-style", "bold");
	await videos.click();
	await expect(videos).toHaveAttribute("aria-expanded", "true");
	await expect(videos.locator("svg")).toHaveAttribute("data-icon-style", "bold");
	await expect(scene.locator("svg")).toHaveAttribute("data-icon-style", "linear");
	await scene.click();
	await expect(scene).toBeChecked();
	await expect(videos).toHaveAttribute("aria-expanded", "false");
	await expect(page.getByRole("complementary", { name: "Clips" })).toHaveCount(0);
	const homeButton = page.getByRole("button", { name: "Home", exact: true });
	await expect(homeButton.locator("svg")).toHaveAttribute("data-icon-style", "bold");
	await homeButton.click();
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	await home.getByRole("button", { name: "Raw", exact: true }).click();
	await expect(home.getByRole("list", { name: "Raw files" }).locator("li")).toHaveCount(2);
	await expect(home.getByRole("textbox", { name: "Search projects" })).toHaveCount(0);
	await home.getByRole("textbox", { name: "Search raw files" }).fill("mic");
	await expect(home.getByRole("list", { name: "Raw files" }).locator("li")).toHaveCount(1);
	await home.getByRole("button", { name: "Options for screen.mic.wav" }).click();
	await page.getByRole("menuitem", { name: "Show screen.mic.wav in folder" }).click();
	await expect(page.locator("html")).toHaveAttribute(
		"data-revealed",
		"/recordings/screen.mic.wav",
	);
	await home.getByRole("textbox", { name: "Search raw files" }).fill("");
	await home.getByRole("button", { name: "Sort raw files" }).click();
	await page.getByRole("menuitem", { name: "Name", exact: true }).click();
	await expect(
		home.getByRole("list", { name: "Raw files" }).locator("li > button").first(),
	).toHaveAccessibleName("screen.mic.wav");
	await expect(page.getByRole("menu", { name: "Sort raw files" })).toHaveCount(0);
	await page.mouse.move(200, 40);
	await page.screenshot({ path: "test-results/dashboard-raw.png", animations: "disabled" });
	await home.getByRole("button", { name: "New folder", exact: true }).click();
	await home.getByRole("button", { name: "Add folder to screen.mp4", exact: true }).click();
	await page.getByRole("menuitem", { name: "Untitled folder", exact: true }).click();
	await home.getByRole("button", { name: "Untitled folder", exact: true }).click();
	await expect(home.getByRole("list", { name: "Raw files" }).locator("li")).toHaveCount(1);
	await home.getByRole("button", { name: "Options for screen.mp4" }).click();
	await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
	await home.getByRole("textbox", { name: "Raw file name" }).fill("Original take");
	await home.getByRole("textbox", { name: "Raw file name" }).press("Enter");
	await expect(home.getByRole("button", { name: "Original take", exact: true })).toBeVisible();
	await home.getByRole("button", { name: "Original take", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "Raw file preview" })).toBeVisible();
	await page.keyboard.press("Escape");
	await home.getByRole("button", { name: "Select raw files to remove" }).click();
	await home.getByRole("button", { name: "Original take", exact: true }).click();
	await home.getByRole("button", { name: "Remove", exact: true }).click();
	await page.getByRole("button", { name: "Remove from library", exact: true }).click();
	await expect(home.getByRole("button", { name: "Original take", exact: true })).toHaveCount(0);
	await home.getByRole("button", { name: "Raw", exact: true }).click();
});

test("project hover plays a muted five-second preview and stops on exit", async ({ page }) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		window.electronAPI.listProjectFiles = async () => ({
			success: true,
			projects: [],
			entries: [
				{
					path: "/projects/hover.recordly",
					name: "Hover preview",
					updatedAt: 1,
					thumbnailPath: null,
					isCurrent: false,
					isInProjectsDirectory: true,
				},
			],
		});
		window.electronAPI.getProjectPreview = async () => {
			document.documentElement.dataset.previewRequests = String(
				Number(document.documentElement.dataset.previewRequests || 0) + 1,
			);
			return {
				success: true,
				value: {
					videoUrl: `${location.origin}/tests/ui/fixtures/preview.mp4`,
					project: {
						version: 1,
						videoPath: "/recordings/preview.mp4",
						editor: {
							clipRegions: [
								{ id: "clip", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 },
							],
						},
					},
				},
			};
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("button", { name: "Export", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const card = page.getByRole("button", { name: "Hover preview", exact: true });
	await expect(card).toBeVisible();
	await expect(page.locator("html")).not.toHaveAttribute("data-preview-requests");
	await card.hover();
	const preview = page.locator("[data-project-hover-preview]");
	await expect(preview).toBeVisible();
	await expect
		.poll(() =>
			preview
				.locator("video")
				.first()
				.evaluate(
					(video: HTMLVideoElement) =>
						!video.paused && video.currentTime > 0 && video.muted,
				),
		)
		.toBe(true);
	const fill = await preview.evaluate((element) => {
		const card = element.getBoundingClientRect();
		const frame = element.firstElementChild!.getBoundingClientRect();
		return {
			card: card.toJSON(),
			frame: frame.toJSON(),
			covers:
				frame.left <= card.left + 1 &&
				frame.top <= card.top + 1 &&
				frame.right >= card.right - 1 &&
				frame.bottom >= card.bottom - 1,
		};
	});
	expect(fill, JSON.stringify(fill)).toMatchObject({ covers: true });
	expect(fill.frame.width / fill.frame.height).toBeCloseTo(4 / 3, 2);
	expect(fill.frame.width).toBeCloseTo(fill.card.width, 0);
	await expect(preview).toHaveCount(0, { timeout: 8000 });
	await page.mouse.move(0, 0);
	await card.hover();
	await expect(preview).toBeVisible();
	await page.mouse.move(0, 0);
	await expect(preview).toHaveCount(0);
});

test("Home opens normally without a current recording", async ({ page }) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		window.electronAPI.getCurrentVideoPath = async () => ({ success: false });
		localStorage.setItem("recordly.open-dashboard", String(Date.now()));
	});
	await page.goto("/?windowType=editor");
	const home = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
	await expect(home).toBeVisible();
	await expect(home.getByRole("textbox", { name: "Search projects" })).toBeVisible();
	await expect(page.getByText("No video to load.", { exact: false })).toHaveCount(0);
	await expect(page.getByRole("alert")).toHaveCount(0);
});

test("folder actions stay inside narrow project cards without clipping", async ({ page }) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		const entries = Array.from({ length: 4 }, (_, index) => ({
			path: `/projects/card-${index}.recordly`,
			name: `Project ${index + 1}`,
			updatedAt: 1,
			thumbnailPath: null,
			isCurrent: false,
			isInProjectsDirectory: true,
		}));
		localStorage.setItem(
			"recordly.project-folders.v1",
			JSON.stringify([
				{
					id: "one",
					name: "A very long folder name",
					color: "#123abc",
					paths: entries.map((entry) => entry.path),
				},
				{
					id: "two",
					name: "Work",
					color: "#123abc",
					paths: entries.map((entry) => entry.path),
				},
			]),
		);
		window.electronAPI.listProjectFiles = async () => ({ success: true, entries });
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	const card = home.getByRole("list", { name: "Your projects" }).locator("li").first();
	const add = card.getByRole("button", { name: "Add folder to Project 1", exact: true });
	for (const width of [800, 1280, 1440]) {
		await page.setViewportSize({ width, height: 1000 });
		await card.hover();
		const folderFits = await card
			.getByRole("button", {
				name: "Remove Project 1 from A very long folder name",
				exact: true,
			})
			.evaluate((element) => {
				const chip = element.getBoundingClientRect();
				const group = element.parentElement!.getBoundingClientRect();
				return (
					chip.left >= group.left &&
					chip.right <= group.right + 1 &&
					element.scrollWidth <= element.clientWidth + 1
				);
			});
		expect(folderFits).toBe(true);
		const bounds = await add.evaluate((element) => {
			const button = element.getBoundingClientRect();
			const caption = element.closest("[data-project-caption]")!.getBoundingClientRect();
			const hit = document.elementFromPoint(button.right - 3, button.top + button.height / 2);
			return {
				inside: button.left >= caption.left && button.right <= caption.right + 1,
				fullWidth: element.scrollWidth <= element.clientWidth + 1,
				reachable: hit !== null && element.contains(hit),
			};
		});
		expect(bounds).toEqual({ inside: true, fullWidth: true, reachable: true });
	}
	await card.evaluate((element) => {
		element.style.width = "600px";
	});
	await expect(
		card.getByRole("button", { name: "Remove Project 1 from Work", exact: true }),
	).toBeVisible();
	await expect(card.locator('[aria-label="1 more folders: Work"]')).toHaveCount(0);
	// Derive the width at which the counter must appear instead of guessing a
	// magic card width: measure the real chip widths and the card chrome, then
	// set the card just narrow enough that both chips cannot share the row.
	const folderRow = await card.evaluate((element) => {
		const host = element.querySelector('[aria-label^="Folders for"]') as HTMLElement;
		const chips = Array.from(
			element.querySelectorAll('button[aria-label^="Remove Project 1 from"]'),
			(chip) => chip.getBoundingClientRect().width,
		);
		return {
			chipWidths: chips.slice(0, 2),
			gap: Number.parseFloat(getComputedStyle(host).columnGap) || 0,
			hostWidth: host.clientWidth,
			cardWidth: element.getBoundingClientRect().width,
		};
	});
	const bothChipsWidth = folderRow.chipWidths[0] + folderRow.gap + folderRow.chipWidths[1];
	const narrowCardWidth = Math.round(
		bothChipsWidth - 20 + (folderRow.cardWidth - folderRow.hostWidth),
	);
	await card.evaluate((element, width) => {
		element.style.width = `${width}px`;
	}, narrowCardWidth);
	await expect(card.locator('[aria-label="1 more folders: Work"]')).toBeVisible();
	await add.click();
	await expect(page.getByRole("menuitem", { name: "Work", exact: true })).toBeVisible();
	await page.keyboard.press("Escape");
	await page.screenshot({ path: "test-results/folder-actions.png", animations: "disabled" });
});

test("sidebar cards, separate Import, and shortcut settings use the dashboard flow", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	const sidebar = home.getByRole("complementary", { name: "Library navigation" });
	await expect(sidebar.getByRole("button", { name: "Import", exact: true })).toHaveCount(0);
	await expect(sidebar.getByRole("img", { name: "Placeholder banner" })).toHaveCount(0);
	const settings = sidebar.getByRole("button", { name: "Settings", exact: true });
	const importButton = home.getByRole("button", { name: "Import", exact: true });
	const all = home.getByRole("button", { name: "All", exact: true });
	expect((await importButton.boundingBox())!.y - (await all.boundingBox())!.y).toBeLessThan(0);
	expect(await all.evaluate((element) => element.parentElement!.textContent)).not.toContain(
		"Import",
	);
	await settings.click();
	await home.getByRole("button", { name: "Customize", exact: true }).click();
	const shortcuts = page.getByRole("dialog", { name: "Keyboard Shortcuts", exact: true });
	await expect(shortcuts).toBeVisible();
	const change = shortcuts.getByRole("button", { name: /^Change Add Zoom shortcut, currently / });
	await change.click();
	await expect(shortcuts.getByRole("button", { name: /^Add Zoom: / })).toHaveAccessibleName(
		/press.*key/i,
	);
	await page.keyboard.press("j");
	await expect(change).toHaveText("J");
	await expect(change).toHaveAccessibleName("Change Add Zoom shortcut, currently J");
	await shortcuts.getByRole("button", { name: "Save", exact: true }).scrollIntoViewIfNeeded();
	await page.screenshot({ path: "test-results/dashboard-shortcuts.png", animations: "disabled" });
	await shortcuts.getByRole("button", { name: "Save", exact: true }).click();
	await expect(shortcuts).not.toBeVisible();
	await home.getByRole("button", { name: "Customize", exact: true }).click();
	await expect(change).toHaveText("J");
	await expect(change).toHaveAccessibleName("Change Add Zoom shortcut, currently J");
	await page.setViewportSize({ width: 800, height: 600 });
	await expect(shortcuts.getByRole("button", { name: "Save", exact: true })).toBeInViewport();
	await expect(
		shortcuts.getByRole("heading", { name: "Keyboard Shortcuts", exact: true }),
	).toBeInViewport();
	await page.screenshot({
		path: "test-results/dashboard-shortcuts-compact.png",
		animations: "disabled",
	});
});

test("empty filtered libraries do not prompt for a first recording", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getCurrentVideoPath = async () => ({ success: false });
	});
	await page.goto("/?windowType=editor");
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	const first = home.getByRole("button", { name: "Record your first video", exact: true });
	await expect(first).toBeVisible();
	await home.getByRole("button", { name: "Last 7 days", exact: true }).click();
	await expect(home.getByText("No matching projects", { exact: true })).toBeVisible();
	await expect(first).toHaveCount(0);
	await home.getByRole("button", { name: "All", exact: true }).click();
	await expect(first).toBeVisible();
	await home.getByRole("button", { name: "New folder", exact: true }).click();
	await home.getByRole("button", { name: "Untitled folder", exact: true }).click();
	await expect(home.getByText("No matching projects", { exact: true })).toBeVisible();
	await expect(first).toHaveCount(0);
});
