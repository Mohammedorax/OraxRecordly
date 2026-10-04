import { Fragment, type CSSProperties } from "react";
import {
	buildKeycastBadgeMetrics,
	formatKeycastToken,
	type KeycastKeystroke,
	type KeycastPosition,
	type KeycastSettings,
	resolveKeycastBadge,
} from "@/lib/keycast/keycastModel";

/**
 * The key badge as DOM.
 *
 * Used by the editor preview, the recording HUD and the settings preview. The
 * badge is pinned LTR (`dir="ltr"`) because a key combination always reads
 * left-to-right, while its offsets use physical `left`/`right`/`top`/`bottom`
 * values so it still sits in the requested corner of an RTL interface.
 */

const PLATE_BACKGROUND = "rgba(15, 23, 42, 0.82)";
const PLATE_BORDER = "1px solid rgba(255, 255, 255, 0.22)";
const CAP_BACKGROUND = "#F8FAFC";
const CAP_BORDER = "1px solid #CBD5E1";
const CAP_COLOR = "#0F172A";
const SEPARATOR_COLOR = "rgba(226, 232, 240, 0.85)";
const FONT_STACK =
	'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

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
}: {
	keys: readonly string[];
	settings: Pick<KeycastSettings, "size">;
	isMac: boolean;
	/** Width of the surface the badge is measured against (preview/output px). */
	containerWidth: number;
	style?: CSSProperties;
}) {
	const metrics = buildKeycastBadgeMetrics(containerWidth, settings);

	return (
		<div
			dir="ltr"
			style={{
				display: "inline-flex",
				alignItems: "center",
				padding: `${metrics.paddingY}px ${metrics.paddingX}px`,
				borderRadius: metrics.capHeight * 0.32,
				background: PLATE_BACKGROUND,
				border: PLATE_BORDER,
				fontFamily: FONT_STACK,
				lineHeight: 1,
				...style,
			}}
		>
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
								color: SEPARATOR_COLOR,
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
							padding: `0 ${metrics.paddingX}px`,
							borderRadius: metrics.capRadius,
							background: CAP_BACKGROUND,
							border: CAP_BORDER,
							color: CAP_COLOR,
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
	return (
		<div
			className={className}
			aria-hidden="true"
			style={{
				position: "absolute",
				zIndex: 20,
				pointerEvents: "none",
				opacity: settings.opacity * badge.opacity,
				...getAnchorStyle(settings.position, metrics.margin),
			}}
		>
			<KeycastKeyCaps
				keys={badge.keys}
				settings={settings}
				isMac={isMac}
				containerWidth={containerWidth}
			/>
		</div>
	);
}
