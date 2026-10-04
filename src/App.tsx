import { Card } from "@heroui/react";
import { lazy, Suspense, useEffect, useState } from "react";
import { AppErrorBoundary } from "./components/system/AppErrorBoundary";
import { useI18n } from "./contexts/I18nContext";
import { APP_ICON_128_SRC } from "./lib/appAssets";
import { loadWithRetry } from "./lib/lazyWithRetry";

// Every lazy window goes through `loadWithRetry`, which retries a failed
// dynamic import once. If it still fails, the rejection surfaces to
// `<AppErrorBoundary>` below (it wraps `<Suspense>`) instead of leaving the
// window on `fallback={null}` forever.
const HudWindow = lazy(() => loadWithRetry(() => import("./components/launch/HudWindow")));
const SourceSelector = lazy(() =>
	loadWithRetry(() =>
		import("./components/launch/SourceSelector").then((module) => ({
			default: module.SourceSelector,
		})),
	),
);
const CountdownOverlay = lazy(() =>
	loadWithRetry(() =>
		import("./components/countdown/CountdownOverlay").then((module) => ({
			default: module.CountdownOverlay,
		})),
	),
);
const UpdateToastWindow = lazy(() =>
	loadWithRetry(() =>
		import("./components/launch/UpdateToastWindow").then((module) => ({
			default: module.UpdateToastWindow,
		})),
	),
);
const EditorWindow = lazy(() =>
	loadWithRetry(() => import("./components/video-editor/EditorWindow")),
);
const ScreenshotRegionOverlay = lazy(() =>
	loadWithRetry(() => import("./components/screenshot-region/ScreenshotRegionOverlay")),
);
const ImageEditorWindow = lazy(() =>
	loadWithRetry(() => import("./components/screenshot/ImageEditorWindow")),
);

export default function App() {
	const [windowType] = useState(
		() => new URLSearchParams(window.location.search).get("windowType") || "",
	);
	const { t } = useI18n();

	useEffect(() => {
		document.documentElement.dataset.windowType = windowType;

		if (
			windowType === "hud-overlay" ||
			windowType === "source-selector" ||
			windowType === "countdown" ||
			windowType === "update-toast" ||
			windowType === "screenshot-region"
		) {
			document.body.style.background = "transparent";
			document.documentElement.style.background = "transparent";
			document.getElementById("root")?.style.setProperty("background", "transparent");
		}

		if (windowType === "hud-overlay") {
			document.documentElement.classList.add("hud-overlay-window");
			document.body.classList.add("hud-overlay-window");
			document.getElementById("root")?.classList.add("hud-overlay-window");
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
		} else if (windowType === "update-toast") {
			document.documentElement.style.overflow = "visible";
			document.body.style.overflow = "visible";
			document.getElementById("root")?.style.setProperty("overflow", "visible");
		}
	}, [windowType]);

	useEffect(() => {
		document.title =
			windowType === "editor"
				? t("app.editorTitle", "Recordly Editor")
				: t("app.name", "Recordly");
	}, [windowType, t]);

	let content;
	switch (windowType) {
		case "hud-overlay":
			content = <HudWindow />;
			break;
		case "source-selector":
			content = <SourceSelector />;
			break;
		case "countdown":
			content = <CountdownOverlay />;
			break;
		case "update-toast":
			content = <UpdateToastWindow />;
			break;
		case "editor":
			content = <EditorWindow />;
			break;
		case "screenshot-region":
			content = <ScreenshotRegionOverlay />;
			break;
		case "image-editor":
			content = <ImageEditorWindow />;
			break;
		default:
			content = (
				<div className="flex h-full w-full items-center justify-center bg-editor-bg text-foreground">
					<Card className="flex-row items-center gap-4 px-6 py-5">
						{/*
						 * Square app icon: this is rendered at 48x48 with `rounded-xl` next
						 * to the product name, so the full "Orax" lockup would be unreadable
						 * here. The lockup lives at `icons/brand/orax-logo.png` for external
						 * use. `APP_ICON_128_SRC` resolves through `import.meta.env.BASE_URL`,
						 * so it works both in the dev server and under `file://`.
						 */}
						<img
							src={APP_ICON_128_SRC}
							alt={t("app.name", "Recordly")}
							className="h-12 w-12 rounded-xl"
						/>
						<div>
							<h1 className="text-xl font-semibold tracking-tight">
								{t("app.name", "Recordly")}
							</h1>
							<p className="text-sm text-foreground/65">
								{t("app.subtitle", "Screen recording and editing")}
							</p>
						</div>
					</Card>
				</div>
			);
	}

	return (
		// The boundary wraps `Suspense`, so it catches both render/lifecycle
		// errors inside a window component and a lazy() import that rejected.
		<AppErrorBoundary windowType={windowType}>
			<Suspense fallback={null}>{content}</Suspense>
		</AppErrorBoundary>
	);
}
