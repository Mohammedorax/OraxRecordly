import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardAnnouncements } from "./DashboardAnnouncements";

// The component reads its labels from the i18n context, which is not mounted in
// this static-markup test. Resolve every lookup to its English fallback so the
// assertions below stay locale-independent.
vi.mock("@/contexts/I18nContext", () => ({
	useScopedT: () => (_key: string, fallback?: string) => fallback ?? _key,
}));

const banner = { src: "/banner.svg", alt: "Product news", href: "https://example.com/news" };
describe("announcement configuration", () => {
	it("hides disabled or empty announcements", () => {
		expect(
			renderToStaticMarkup(
				<DashboardAnnouncements config={{ enabled: false, banners: [banner] }} />,
			),
		).toBe("");
		expect(
			renderToStaticMarkup(
				<DashboardAnnouncements config={{ enabled: true, banners: [] }} />,
			),
		).toBe("");
	});
	it("renders a linked single image without navigation", () => {
		const html = renderToStaticMarkup(
			<DashboardAnnouncements config={{ enabled: true, banners: [banner] }} />,
		);
		expect(html).toContain('href="https://example.com/news"');
		expect(html).toContain('alt="Product news"');
		expect(html).not.toContain("Next announcement");
		expect(html).not.toContain("Previous announcement");
	});
	it("renders navigation for multiple banners and does not activate non-web links", () => {
		const html = renderToStaticMarkup(
			<DashboardAnnouncements
				config={{
					enabled: true,
					banners: [
						{ ...banner, src: "/banner-1.svg", href: "javascript:alert(1)" },
						{ ...banner, src: "/banner-2.svg" },
					],
				}}
			/>,
		);
		expect(html).toContain("Next announcement");
		expect(html).not.toContain("javascript:");
	});
});
