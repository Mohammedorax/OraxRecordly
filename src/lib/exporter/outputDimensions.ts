import type { GIF_SIZE_PRESETS, GifSizePreset } from "./types";

/**
 * Pure GIF output-dimension maths, deliberately kept out of `gifExporter.ts`:
 * that module imports `gif.js` and builds its worker URL at module scope, so any
 * static import of it drags the whole GIF encoder into whatever chunk imports it.
 * The export settings UI only needs this calculation, so it lives here.
 */
export function calculateOutputDimensions(
	sourceWidth: number,
	sourceHeight: number,
	sizePreset: GifSizePreset,
	sizePresets: typeof GIF_SIZE_PRESETS,
): { width: number; height: number } {
	const preset = sizePresets[sizePreset];
	const maxHeight = preset.maxHeight;

	// If original is smaller than max height or preset is 'original', use source dimensions
	if (sourceHeight <= maxHeight || sizePreset === "original") {
		return { width: sourceWidth, height: sourceHeight };
	}

	// Calculate scaled dimensions preserving aspect ratio
	const aspectRatio = sourceWidth / sourceHeight;
	const newHeight = maxHeight;
	const newWidth = Math.round(newHeight * aspectRatio);

	// Ensure dimensions are even (required for some encoders)
	return {
		width: newWidth % 2 === 0 ? newWidth : newWidth + 1,
		height: newHeight % 2 === 0 ? newHeight : newHeight + 1,
	};
}
