import { Component, type ErrorInfo, type ReactNode, useCallback, useState } from "react";
import { useI18n } from "@/contexts/I18nContext";
import { APP_ICON_128_SRC } from "@/lib/appAssets";
import { writeClipboardText } from "@/lib/clipboard";

/**
 * Reload the renderer. A rejected dynamic import (a chunk that was missing or
 * corrupt on this load) can succeed once the window loads again, so the error
 * surface always offers this as the way out.
 */
export function reloadWindow() {
	window.location.reload();
}

/** Full, copy-pasteable description of the failure, with no user data in it. */
function formatErrorDetails(error: Error, windowType?: string): string {
	const windowLabel = windowType ? ` (${windowType} window)` : "";
	const lines = [`OraxRecordly${windowLabel}`, `${error.name}: ${error.message}`];
	if (error.stack) {
		lines.push("", error.stack);
	}
	return lines.join("\n");
}

export interface ErrorFallbackProps {
	error: Error;
	/** `?windowType=` value, shown so support knows which window failed. */
	windowType?: string;
	onReload: () => void;
}

/**
 * The visible failure surface.
 *
 * It deliberately paints an opaque background from inline styles rather than
 * only from Tailwind/CSS variables: five window types (hud-overlay,
 * source-selector, countdown, update-toast, screenshot-region) have `html`,
 * `body` and `#root` made transparent in `App.tsx` so the OS window shows
 * through, and a failure there would otherwise be an invisible always-on-top
 * window that looks frozen. It uses plain `<button>` elements so it keeps
 * working even if the component library or its chunk is what failed.
 */
export function ErrorFallback({ error, windowType, onReload }: ErrorFallbackProps) {
	const { t } = useI18n();
	const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
	const details = formatErrorDetails(error, windowType);

	const handleCopy = useCallback(() => {
		void writeClipboardText(details).then(
			() => setCopyState("copied"),
			() => setCopyState("failed"),
		);
	}, [details]);

	const copyLabel =
		copyState === "copied"
			? t("common.errorBoundary.copied", "Details copied")
			: copyState === "failed"
				? t("common.errorBoundary.copyFailed", "Could not copy the details")
				: t("common.errorBoundary.copyDetails", "Copy details");

	return (
		<div
			role="alert"
			className="fixed inset-0 z-50 flex items-center justify-center overflow-auto p-6"
			style={{
				backgroundColor: "var(--background, #0f0f13)",
				color: "var(--foreground, #f5f5f5)",
				pointerEvents: "auto",
			}}
		>
			<div
				className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-foreground/10 p-6 shadow-2xl"
				style={{ backgroundColor: "var(--surface, #1a1a20)" }}
			>
				<div className="flex items-center gap-3">
					<img
						src={APP_ICON_128_SRC}
						alt=""
						className="h-10 w-10 shrink-0 rounded-xl"
						onError={(event) => {
							// The product name below is the real fallback; never show a
							// broken-image glyph on top of an error.
							event.currentTarget.style.display = "none";
						}}
					/>
					<div>
						<p className="text-xs uppercase tracking-wide text-foreground/55">
							{t("app.name", "OraxRecordly")}
						</p>
						<h1 className="text-lg font-semibold">
							{t("common.errorBoundary.title", "Something went wrong")}
						</h1>
					</div>
				</div>

				<p className="text-sm text-foreground/70">
					{t(
						"common.errorBoundary.description",
						"OraxRecordly hit an unexpected error and could not finish drawing this window. Reloading usually fixes it.",
					)}
				</p>

				<details className="w-full rounded-lg border border-foreground/10 bg-black/20 p-3">
					<summary className="cursor-pointer text-xs font-medium text-foreground/70">
						{t("common.errorBoundary.details", "Technical details")}
					</summary>
					<pre
						dir="ltr"
						className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-left text-[11px] leading-relaxed text-foreground/60"
					>
						{details}
					</pre>
				</details>

				<div className="flex w-full flex-wrap items-center gap-2">
					<button
						type="button"
						onClick={onReload}
						className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
					>
						{t("common.errorBoundary.reload", "Reload")}
					</button>
					<button
						type="button"
						onClick={handleCopy}
						className="rounded-lg border border-foreground/20 px-4 py-2 text-sm font-medium text-foreground"
					>
						{copyLabel}
					</button>
				</div>
			</div>
		</div>
	);
}

export interface AppErrorBoundaryProps {
	children: ReactNode;
	/** `?windowType=` value; used only to label logs and the fallback. */
	windowType?: string;
}

interface AppErrorBoundaryState {
	error: Error | null;
}

/**
 * Catches render/lifecycle failures for one window's content.
 *
 * It sits *outside* the `<Suspense>` boundary in `App.tsx`, which is what makes
 * it catch a rejected `lazy()` import as well: React rethrows the rejection
 * from the suspended tree, so without this boundary the window renders
 * `fallback={null}` forever. Errors from event handlers, timers and async code
 * are not caught here (React boundaries never do), so already-handled failures
 * keep reporting themselves the way they do today.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
	state: AppErrorBoundaryState = { error: null };

	static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		const windowType = this.props.windowType || "unknown";
		// Enough context for support to identify the failing window; nothing
		// that could contain recordings, transcripts or user documents.
		console.error(
			`[recordly] Render error in "${windowType}" window`,
			error,
			info.componentStack,
		);

		if (windowType === "hud-overlay") {
			// `App.tsx` makes the HUD click-through while it renders normally.
			// The error surface has buttons, so it must take the mouse back or
			// Reload would be unreachable.
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
		}
	}

	render() {
		if (this.state.error) {
			return (
				<ErrorFallback
					error={this.state.error}
					windowType={this.props.windowType}
					onReload={reloadWindow}
				/>
			);
		}

		return this.props.children;
	}
}
