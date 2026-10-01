import { formatClipSpeedLabel } from "../../clipSpeedChange";
import type {
	AnnotationRegion,
	AudioRegion,
	CaptionCue,
	ClipRegion,
	ZoomRegion,
} from "../../types";
import { getClipSourceEndMs, getClipSourceStartMs } from "../../types";
import { CAPTION_ROW_ID, CLIP_ROW_ID, ZOOM_ROW_ID } from "../core/constants";
import {
	getAnnotationTrackIndex,
	getAnnotationTrackRowId,
	getAudioTrackIndex,
	getAudioTrackRowId,
	isAnnotationTrackRowId,
	isAudioTrackRowId,
} from "../core/rows";
import type { TimelineRegionSpan, TimelineRenderItem } from "../core/timelineTypes";

export type TimelineLabelTranslator = (
	key: string,
	fallback?: string,
	vars?: Record<string, string | number>,
) => string;

/**
 * Resolve a label through the i18n translator when one is supplied, otherwise
 * interpolate the English fallback locally so pure model callers (and tests)
 * keep their existing output.
 */
function translateLabel(
	t: TimelineLabelTranslator | undefined,
	key: string,
	fallback: string,
	vars?: Record<string, string | number>,
): string {
	if (t) return t(key, fallback, vars);
	if (!vars) return fallback;
	return fallback.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, name) =>
		vars[name] === undefined ? "" : String(vars[name]),
	);
}

export function getAnnotationLabel(region: AnnotationRegion, t?: TimelineLabelTranslator): string {
	if (region.type === "text") {
		const preview = region.content.trim();
		if (!preview) {
			return translateLabel(t, "editor.timeline.annotation.emptyText", "Empty text");
		}
		return preview.length > 20 ? `${preview.substring(0, 20)}...` : preview;
	}
	if (region.type === "image") {
		return translateLabel(t, "timeline.annotation.image", "Image");
	}
	return translateLabel(t, "timeline.annotation.label", "Annotation");
}

export function getAudioLabel(region: AudioRegion, t?: TimelineLabelTranslator): string {
	return (
		region.audioPath
			.split(/[\\/]/)
			.pop()
			?.replace(/\.[^.]+$/, "") || translateLabel(t, "timeline.audio.label", "Audio")
	);
}

function getCaptionLabel(cue: CaptionCue, t?: TimelineLabelTranslator): string {
	const preview =
		cue.text.trim() || translateLabel(t, "editor.timeline.caption.label", "Caption");
	return preview.length > 24 ? `${preview.substring(0, 24)}...` : preview;
}

export function buildTimelineItems(params: {
	zoomRegions: ZoomRegion[];
	clipRegions: ClipRegion[];
	annotationRegions: AnnotationRegion[];
	audioRegions: AudioRegion[];
	captionCues?: CaptionCue[];
	t?: TimelineLabelTranslator;
}): TimelineRenderItem[] {
	const {
		zoomRegions,
		clipRegions,
		annotationRegions,
		audioRegions,
		captionCues = [],
		t,
	} = params;
	const zooms: TimelineRenderItem[] = zoomRegions.map((region, index) => ({
		id: region.id,
		rowId: ZOOM_ROW_ID,
		span: { start: region.startMs, end: region.endMs },
		label: translateLabel(t, "timeline.zoom.label", "Zoom {{index}}", { index: index + 1 }),
		zoomDepth: region.depth,
		zoomMode: region.mode ?? "auto",
		variant: "zoom",
	}));

	const clips: TimelineRenderItem[] = clipRegions.map((region, index) => {
		const speed = Number.isFinite(region.speed) && region.speed > 0 ? region.speed : 1;
		const sourceEndMs = getClipSourceEndMs(region);
		const speedLabel = formatClipSpeedLabel(speed);
		const label = speedLabel
			? translateLabel(t, "editor.timeline.clip.speedLabel", "Clip {{index}} {{speed}}", {
					index: index + 1,
					speed: speedLabel,
				})
			: translateLabel(t, "editor.timeline.clip.label", "Clip {{index}}", {
					index: index + 1,
				});

		return {
			id: region.id,
			rowId: CLIP_ROW_ID,
			span: { start: region.startMs, end: region.endMs },
			sourceSpan: { start: getClipSourceStartMs(region), end: sourceEndMs },
			label,
			speedValue: speedLabel ? speed : undefined,
			showSourceAudio: region.showSourceAudio,
			muted: Boolean(region.muted),
			variant: "clip",
		};
	});

	const annotations: TimelineRenderItem[] = annotationRegions.map((region) => ({
		id: region.id,
		rowId: getAnnotationTrackRowId(region.trackIndex ?? 0),
		span: { start: region.startMs, end: region.endMs },
		label: getAnnotationLabel(region, t),
		variant: "annotation",
	}));

	const audios: TimelineRenderItem[] = audioRegions.map((region) => ({
		id: region.id,
		rowId: getAudioTrackRowId(region.trackIndex ?? 0),
		span: { start: region.startMs, end: region.endMs },
		label: getAudioLabel(region, t),
		audioPath: region.audioPath,
		audioGain: region.volume,
		audioNormalize: Boolean(region.normalize),
		variant: "audio",
	}));

	const captions: TimelineRenderItem[] = captionCues.map((cue) => ({
		id: cue.id,
		rowId: CAPTION_ROW_ID,
		span: { start: cue.startMs, end: cue.endMs },
		label: getCaptionLabel(cue, t),
		variant: "caption",
	}));

	return [...zooms, ...clips, ...annotations, ...audios, ...captions];
}

export function buildAllRegionSpans(params: {
	annotationRegions?: AnnotationRegion[];
	captionCues?: CaptionCue[];
	zoomRegions: ZoomRegion[];
	clipRegions: ClipRegion[];
	audioRegions: AudioRegion[];
}): TimelineRegionSpan[] {
	const { zoomRegions, clipRegions, audioRegions } = params;
	const zooms = zoomRegions.map((r) => ({
		id: r.id,
		start: r.startMs,
		end: r.endMs,
		rowId: ZOOM_ROW_ID,
	}));
	const clips = clipRegions.map((r) => ({
		id: r.id,
		start: r.startMs,
		end: r.endMs,
		rowId: CLIP_ROW_ID,
	}));
	const audios = audioRegions.map((r) => ({
		id: r.id,
		start: r.startMs,
		end: r.endMs,
		rowId: getAudioTrackRowId(r.trackIndex ?? 0),
	}));
	return [
		...zooms,
		...clips,
		...audios,
		...(params.annotationRegions ?? []).map((r) => ({
			id: r.id,
			start: r.startMs,
			end: r.endMs,
			rowId: getAnnotationTrackRowId(r.trackIndex ?? 0),
		})),
		...(params.captionCues ?? []).map((r) => ({
			id: r.id,
			start: r.startMs,
			end: r.endMs,
			rowId: CAPTION_ROW_ID,
		})),
	];
}

export function resolveDropRowId(
	id: string,
	proposedRowId: string,
	timelineItems: TimelineRenderItem[],
) {
	const currentRowId = timelineItems.find((item) => item.id === id)?.rowId;
	if (!currentRowId) {
		return proposedRowId;
	}

	if (isAnnotationTrackRowId(currentRowId)) {
		return isAnnotationTrackRowId(proposedRowId)
			? getAnnotationTrackRowId(getAnnotationTrackIndex(proposedRowId))
			: currentRowId;
	}

	if (isAudioTrackRowId(currentRowId)) {
		return isAudioTrackRowId(proposedRowId)
			? getAudioTrackRowId(getAudioTrackIndex(proposedRowId))
			: currentRowId;
	}

	return currentRowId;
}
