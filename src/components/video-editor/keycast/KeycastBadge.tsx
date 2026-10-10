import { type CSSProperties, Fragment } from "react";
import {
	buildKeycastBadgeMetrics,
	formatKeycastKeys,
	formatKeycastToken,
	type KeycastKeystroke,
	type KeycastPosition,
	type KeycastSettings,
	type KeycastStyle,
	resolveKeycastBadge,
	resolveKeycastHistory,
} from "@/lib/keycast/keycastModel";

/**
 * The key badge as DOM.
 *
 * Used by the editor preview, the recording HUD and the settings preview. The
 * badge is pinned LTR (`dir="ltr"`) because a key combination always reads
 * left-to-right, while its offsets use physical `left`/`right`/`top`/`bottom`
 * values so it still sits in the requested corner of an RTL interface.
 *
 * The canvas renderer in `lib/keycast/keycastRenderer.ts` paints the same three
 * styles and the same optional second line for the exported file.
 */

const PLATE_BACKGROUND = "rgba(15, 23, 42, 0.82)";
const PLATE_BORDER = "rgba(255, 255, 255, 0.22)";
const CAP_BACKGROUND = "#F8FAFC";
const CAP_BORDER = "#CBD5E1";
const CAP_COLOR = "#0F172A";
const SEPARATOR_COLOR = "rgba(226, 232, 240, 0.85)";
const HISTORY_COLOR = "rgba(226, 232, 240, 0.78)";
const MINIMAL_COLOR = "#FFFFFF";
const MINIMAL_SHADOW = "0 1px 3px rgba(0, 0, 0, 0.65)";
const FONT_STACK =
	'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

type KeycastLook = Pick<KeycastSettings, "size"> &
	Partial<Pick<KeycastSettings, "style" | "accentColor">>;

function getAnchorStyle(position: KeycastPosition, margin: number): CSSProperties {
	switch (position) {
		case "top-left":
			return { top: margin, left: margin };
		case "top-center":
			return { top: margin, left: "50%", transform: "translateX(-50%)" };
		case "top-right":
			return { top: margin, right: margin };
		case "bottom-left":
			return { bottom: margin, left: margin };
		case "bottom-center":
			return { bottom: margin, left: "50%", transform: "translateX(-50%)" };
		case "bottom-right":
		default:
			return { bottom: margin, right: margin };
	}
}

export function KeycastKeyCaps({
	keys,
	settings,
	isMac,
	containerWidth,
	style,
	historyLabels = [],
	fullWidth = false,
}: {
	keys: readonly string[];
	settings: KeycastLook;
	isMac: boolean;
	/** Width of the surface the badge is measured against (preview/output px). */
	containerWidth: number;
	style?: CSSProperties;
	/** Formatted earlier shortcuts, drawn as the second line. */
	historyLabels?: readonly string[];
	/** A "bar" spans its surface instead of hugging the keys. */
	fullWidth?: boolean;
}) {
	const metrics = buildKeycastBadgeMetrics(containerWidth, settings);
	const look: KeycastStyle = settings.style ?? "pill";
	const accent = settings.accentColor ?? null;
	const historyFontSize = Math.max(1, Math.round(metrics.capHeight * 0.4));
	const hasHistory = look !== "minimal" && historyLabels.length > 0;

	return (
		<div
			dir="ltr"
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "flex-start",
				gap: hasHistory ? Math.round(metrics.paddingY * 0.6) : 0,
				padding: `${metrics.paddingY}px ${metrics.paddingX}px`,
				borderRadius: metrics.capHeight * (look === "bar" ? 0.12 : 0.32),
				background: look === "minimal" ? "transparent" : PLATE_BACKGROUND,
				border: look === "minimal" ? "none" : `1px solid ${accent ?? PLATE_BORDER}`,
				fontFamily: FONT_STACK,
				lineHeight: 1,
				boxSizing: "border-box",
				...(fullWidth || look === "bar" ? { width: "100%" } : {}),
				...style,
			}}
		>
			<div style={{ display: "inline-flex", alignItems: "center" }}>
				{keys.map((key, index) => (
					<Fragment key={`${key}-${index}`}>
						{index > 0 ? (
							// Fixed-width separator, exactly like the canvas renderer, so the
							// DOM preview and the burned-in badge space their caps identically.
							<span
								style={{
									display: "inline-flex",
									alignItems: "center",
									justifyContent: "center",
									width: metrics.separatorWidth,
									color: accent ?? SEPARATOR_COLOR,
									fontSize: metrics.fontSize,
									fontWeight: 600,
								}}
							>
								+
							</span>
						) : null}
						<span
							style={{
								display: "inline-flex",
								alignItems: "center",
								justifyContent: "center",
								minWidth: metrics.capHeight,
								height: metrics.capHeight,
								padding: look === "minimal" ? 0 : `0 ${metrics.paddingX}px`,
								borderRadius: metrics.capRadius,
								background: look === "minimal" ? "transparent" : CAP_BACKGROUND,
								border:
									look === "minimal"
										? "none"
										: `1px solid ${accent ?? CAP_BORDER}`,
								color: look === "minimal" ? (accent ?? MINIMAL_COLOR) : CAP_COLOR,
								textShadow: look === "minimal" ? MINIMAL_SHADOW : undefined,
								fontSize: metrics.fontSize,
								fontWeight: 600,
								boxSizing: "border-box",
							}}
						>
							{formatKeycastToken(key, isMac)}
						</span>
					</Fragment>
				))}
			</div>
			{hasHistory ? (
				<span
					style={{
						color: accent ?? HISTORY_COLOR,
						fontSize: historyFontSize,
						fontWeight: 500,
						whiteSpace: "nowrap",
					}}
				>
					{historyLabels.join("   ")}
				</span>
			) : null}
		</div>
	);
}

/**
 * Absolutely positioned badge for a surface whose width is known. Renders
 * nothing when the overlay is off or the badge has faded.
 */
export function KeycastBadgeOverlay({
	events,
	settings,
	isMac,
	containerWidth,
	timeMs,
	className,
}: {
	events: readonly KeycastKeystroke[];
	settings: KeycastSettings;
	isMac: boolean;
	containerWidth: number;
	timeMs: number;
	className?: string;
}) {
	if (!settings.enabled || containerWidth <= 0) {
		return null;
	}

	const badge = resolveKeycastBadge(events, timeMs, { holdMs: settings.holdMs });
	if (!badge) {
		return null;
	}

	const metrics = buildKeycastBadgeMetrics(containerWidth, settings);
	const historyLabels =
		settings.lines === 2
			? resolveKeycastHistory(events, timeMs, { holdMs: settings.holdMs }).map((keys) =>
					formatKeycastKeys(keys, isMac).join(" + "),
				)
			: [];

	return (
		<div
			className={className}
			aria-hidden="true"
			style={{
				position: "absolute",
				zIndex: 20,
				pointerEvents: "none",
				opacity: settings.opacity * badge.opacity,
				...(settings.style === "bar"
					? { left: metrics.margin, right: metrics.margin }
					: null),
				...getAnchorStyle(settings.position, metrics.margin),
			}}
		>
			<KeycastKeyCaps
				keys={badge.keys}
				settings={settings}
				isMac={isMac}
				containerWidth={containerWidth}
				historyLabels={historyLabels}
			/>
		</div>
	);
}
