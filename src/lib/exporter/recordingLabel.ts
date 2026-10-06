/**
 * Shared painter for the "recording label" overlay: the clip name plus the
 * recording date/time, burned into the exported frame as a small badge.
 *
 * Kept renderer-agnostic so both export pipelines (the Pixi-based modern
 * renderer and the 2D-composite legacy renderer) share identical output.
 */

const LABEL_FONT_STACK = '"Segoe UI", "Noto Sans Arabic", system-ui, -apple-system, sans-serif';
const MIN_FONT_SIZE = 14;
const MAX_FONT_SIZE = 34;
const FONT_SIZE_HEIGHT_RATIO = 0.026;

export interface RecordingLabelPaintOptions {
	text: string;
	width: number;
	height: number;
}

/** Font size used for a given output height (exported and measured identically). */
export function getRecordingLabelFontSize(height: number): number {
	return Math.min(
		MAX_FONT_SIZE,
		Math.max(MIN_FONT_SIZE, Math.round(height * FONT_SIZE_HEIGHT_RATIO)),
	);
}

export function paintRecordingLabel(
	context: CanvasRenderingContext2D,
	options: RecordingLabelPaintOptions,
): void {
	const text = options.text.trim();
	if (!text || options.width <= 0 || options.height <= 0) {
		return;
	}

	const fontSize = getRecordingLabelFontSize(options.height);
	const paddingX = Math.round(fontSize * 0.75);
	const paddingY = Math.round(fontSize * 0.42);
	const margin = Math.round(Math.max(16, options.height * 0.03));

	context.save();
	context.font = `600 ${fontSize}px ${LABEL_FONT_STACK}`;
	context.textBaseline = "middle";
	const textWidth = context.measureText(text).width;

	const boxWidth = Math.ceil(textWidth + paddingX * 2);
	const boxHeight = Math.ceil(fontSize + paddingY * 2);
	const x = margin;
	const y = Math.max(0, options.height - margin - boxHeight);

	context.beginPath();
	context.roundRect(x, y, boxWidth, boxHeight, Math.round(fontSize * 0.5));
	context.fillStyle = "rgba(0, 0, 0, 0.55)";
	context.fill();

	context.fillStyle = "#ffffff";
	context.fillText(text, x + paddingX, y + Math.round(boxHeight / 2));
	context.restore();
}
