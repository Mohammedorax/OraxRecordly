import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import enCommon from "@/i18n/locales/en/common.json";
import enDialogs from "@/i18n/locales/en/dialogs.json";
import { AboutDialogBody } from "./AboutDialog";

// The dialog body reads its copy from the i18n context, which is not mounted in
// this static-markup test. Resolve lookups against the shipped English locale
// files so the assertions below cover the wording that actually ships — the
// component's own English fallbacks are only a crash guard.
vi.mock("@/contexts/I18nContext", () => {
	const bundles: Record<string, unknown> = { common: enCommon, dialogs: enDialogs };
	const interpolate = (template: string, vars?: Record<string, string | number>) =>
		vars
			? template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) =>
					String(vars[key] ?? ""),
				)
			: template;
	const lookup = (key: string) => {
		let current: unknown = bundles;
		for (const part of key.split(".")) {
			if (!current || typeof current !== "object") return undefined;
			current = (current as Record<string, unknown>)[part];
		}
		return typeof current === "string" ? current : undefined;
	};
	const t = (key: string, fallback?: string, vars?: Record<string, string | number>) =>
		interpolate(lookup(key) ?? fallback ?? key, vars);
	return {
		useI18n: () => ({ t }),
		useScopedT: (namespace: string) => (key: string, fallback?: string, vars?: unknown) =>
			t(`${namespace}.${key}`, fallback, vars as Record<string, string | number>),
	};
});

const render = (version: string | null = "9.9.9") =>
	renderToStaticMarkup(<AboutDialogBody version={version} />);

describe("about surface", () => {
	it("shows the product name and the version it was given", () => {
		const html = render();
		expect(html).toContain("OraxRecordly");
		expect(html).toContain("Version 9.9.9");
	});

	it("attributes the upstream Recordly project and links to it", () => {
		const html = render();
		expect(html).toContain("Attribution");
		expect(html).toContain("fork and derivative work of Recordly by webadderall");
		expect(html).toContain("Copyright © 2026 webadderall");
		expect(html).toContain('href="https://github.com/webadderallorg/Recordly"');
	});

	it("names the licence and points at the repository copy", () => {
		const html = render();
		expect(html).toContain("GNU Affero General Public License v3.0 (AGPL-3.0)");
		expect(html).toContain("complete corresponding source code");
		expect(html).toContain(
			'href="https://github.com/Mohammedorax/OraxRecordly/blob/main/LICENSE.md"',
		);
	});

	it("links the repository, the releases page and the third-party notices", () => {
		const html = render();
		expect(html).toContain('href="https://github.com/Mohammedorax/OraxRecordly"');
		expect(html).toContain('href="https://github.com/Mohammedorax/OraxRecordly/releases"');
		expect(html).toContain(
			'href="https://github.com/Mohammedorax/OraxRecordly/blob/main/THIRD_PARTY_NOTICES.md"',
		);
	});

	it("lists the bundled third-party components", () => {
		const html = render();
		expect(html).toContain("Electron and Chromium");
		expect(html).toContain("FFmpeg");
		expect(html).toContain("Thmanyah Serif Display");
	});

	it("states that the software comes with no warranty", () => {
		const html = render();
		expect(html).toContain("No warranty");
		expect(html).toContain("absolutely no warranty");
		expect(html).toContain("GNU AGPL-3.0 for details");
	});

	it("renders without a version when the app did not provide one", () => {
		expect(render(null)).toContain("Version …");
	});
});
