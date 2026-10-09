import { useCallback, useState } from "react";
import type { KeycastSettings } from "@/lib/keycast/keycastModel";
import { loadKeycastSettings, saveKeycastSettings } from "@/lib/keycast/keycastSettings";
import type { EditorPreferences } from "../editorPreferences";
import type {
	CropRegion,
	CursorClickEffectStyle,
	CursorStyle,
	ZoomMotionBlurTuning,
	ZoomTransitionEasing,
} from "../types";
import {
	DEFAULT_CONNECTED_ZOOM_DURATION_MS,
	DEFAULT_CONNECTED_ZOOM_EASING,
	DEFAULT_CONNECTED_ZOOM_GAP_MS,
	DEFAULT_CROP_REGION,
	DEFAULT_CURSOR_STYLE,
	DEFAULT_ZOOM_IN_DURATION_MS,
	DEFAULT_ZOOM_IN_EASING,
	DEFAULT_ZOOM_IN_OVERLAP_MS,
	DEFAULT_ZOOM_MOTION_BLUR_TUNING,
	DEFAULT_ZOOM_OUT_DURATION_MS,
	DEFAULT_ZOOM_OUT_EASING,
} from "../types";

export function useAppearanceState(preferences: EditorPreferences) {
	const [wallpaper, setWallpaper] = useState(preferences.wallpaper);
	const [shadowIntensity, setShadowIntensity] = useState(preferences.shadowIntensity);
	const [backgroundBlur, setBackgroundBlur] = useState(preferences.backgroundBlur);
	const [zoomMotionBlur, setZoomMotionBlur] = useState(preferences.zoomMotionBlur);
	const [zoomMotionBlurTuning, setZoomMotionBlurTuning] = useState<ZoomMotionBlurTuning>(
		preferences.zoomMotionBlurTuning ?? DEFAULT_ZOOM_MOTION_BLUR_TUNING,
	);
	const [autoApplyFreshRecordingAutoZooms, setAutoApplyFreshRecordingAutoZooms] = useState(
		preferences.autoApplyFreshRecordingAutoZooms,
	);
	const [connectZooms, setConnectZooms] = useState(preferences.connectZooms);
	const [zoomInDurationMs, setZoomInDurationMs] = useState(
		preferences.zoomInDurationMs ?? DEFAULT_ZOOM_IN_DURATION_MS,
	);
	const [zoomInOverlapMs, setZoomInOverlapMs] = useState(
		preferences.zoomInOverlapMs ?? DEFAULT_ZOOM_IN_OVERLAP_MS,
	);
	const [zoomOutDurationMs, setZoomOutDurationMs] = useState(
		preferences.zoomOutDurationMs ?? DEFAULT_ZOOM_OUT_DURATION_MS,
	);
	const [connectedZoomGapMs, setConnectedZoomGapMs] = useState(
		preferences.connectedZoomGapMs ?? DEFAULT_CONNECTED_ZOOM_GAP_MS,
	);
	const [connectedZoomDurationMs, setConnectedZoomDurationMs] = useState(
		preferences.connectedZoomDurationMs ?? DEFAULT_CONNECTED_ZOOM_DURATION_MS,
	);
	const [zoomInEasing, setZoomInEasing] = useState<ZoomTransitionEasing>(
		preferences.zoomInEasing ?? DEFAULT_ZOOM_IN_EASING,
	);
	const [zoomOutEasing, setZoomOutEasing] = useState<ZoomTransitionEasing>(
		preferences.zoomOutEasing ?? DEFAULT_ZOOM_OUT_EASING,
	);
	const [connectedZoomEasing, setConnectedZoomEasing] = useState<ZoomTransitionEasing>(
		preferences.connectedZoomEasing ?? DEFAULT_CONNECTED_ZOOM_EASING,
	);
	const [showCursor, setShowCursor] = useState(preferences.showCursor);
	const [loopCursor, setLoopCursor] = useState(preferences.loopCursor);
	const [cursorStyle, setCursorStyle] = useState<CursorStyle>(
		preferences.cursorStyle ?? DEFAULT_CURSOR_STYLE,
	);
	const [cursorSize, setCursorSize] = useState(preferences.cursorSize);
	const [cursorSmoothing, setCursorSmoothing] = useState(preferences.cursorSmoothing);
	const [cursorSpringStiffnessMultiplier, setCursorSpringStiffnessMultiplier] = useState(
		preferences.cursorSpringStiffnessMultiplier,
	);
	const [cursorSpringDampingMultiplier, setCursorSpringDampingMultiplier] = useState(
		preferences.cursorSpringDampingMultiplier,
	);
	const [cursorSpringMassMultiplier, setCursorSpringMassMultiplier] = useState(
		preferences.cursorSpringMassMultiplier,
	);
	const [cameraSpringStiffnessMultiplier, setCameraSpringStiffnessMultiplier] = useState(
		preferences.cameraSpringStiffnessMultiplier,
	);
	const [cameraSpringDampingMultiplier, setCameraSpringDampingMultiplier] = useState(
		preferences.cameraSpringDampingMultiplier,
	);
	const [cameraSpringMassMultiplier, setCameraSpringMassMultiplier] = useState(
		preferences.cameraSpringMassMultiplier,
	);
	const [zoomSmoothness, setZoomSmoothness] = useState(0.5);
	const [zoomClassicMode, setZoomClassicMode] = useState(false);
	const [cursorMotionBlur, setCursorMotionBlur] = useState(preferences.cursorMotionBlur);
	const [cursorClickEffect, setCursorClickEffect] = useState<CursorClickEffectStyle>(
		preferences.cursorClickEffect,
	);
	const [cursorClickEffectColor, setCursorClickEffectColor] = useState(
		preferences.cursorClickEffectColor,
	);
	const [cursorClickEffectScale, setCursorClickEffectScale] = useState(
		preferences.cursorClickEffectScale,
	);
	const [cursorClickEffectOpacity, setCursorClickEffectOpacity] = useState(
		preferences.cursorClickEffectOpacity,
	);
	const [cursorClickEffectDurationMs, setCursorClickEffectDurationMs] = useState(
		preferences.cursorClickEffectDurationMs,
	);
	const [cursorClickBounce, setCursorClickBounce] = useState(preferences.cursorClickBounce);
	const [cursorClickBounceDuration, setCursorClickBounceDuration] = useState(
		preferences.cursorClickBounceDuration,
	);
	const [cursorSway, setCursorSway] = useState(preferences.cursorSway);
	const [borderRadius, setBorderRadius] = useState(preferences.borderRadius);
	const [padding, setPadding] = useState(preferences.padding);
	const [cropRegion, setCropRegion] = useState<CropRegion>(DEFAULT_CROP_REGION);
	/**
	 * Keystroke overlay settings are app-level (not part of the project), so they
	 * load from the persisted app settings and every change is written back
	 * immediately — the same lifecycle the editor preferences use.
	 */
	const [keycastSettings, setKeycastSettingsState] = useState<KeycastSettings>(() =>
		loadKeycastSettings(),
	);
	const setKeycastSettings = useCallback((next: KeycastSettings) => {
		const saved = saveKeycastSettings(next);
		setKeycastSettingsState(saved);
		// Mirror the opt-in flag into the main process so the global input hook
		// knows whether it may record keys during a recording.
		void window.electronAPI?.setKeycastSettings?.(saved);
	}, []);

	return {
		wallpaper,
		setWallpaper,
		shadowIntensity,
		setShadowIntensity,
		backgroundBlur,
		setBackgroundBlur,
		zoomMotionBlur,
		setZoomMotionBlur,
		zoomMotionBlurTuning,
		setZoomMotionBlurTuning,
		autoApplyFreshRecordingAutoZooms,
		setAutoApplyFreshRecordingAutoZooms,
		connectZooms,
		setConnectZooms,
		zoomInDurationMs,
		setZoomInDurationMs,
		zoomInOverlapMs,
		setZoomInOverlapMs,
		zoomOutDurationMs,
		setZoomOutDurationMs,
		connectedZoomGapMs,
		setConnectedZoomGapMs,
		connectedZoomDurationMs,
		setConnectedZoomDurationMs,
		zoomInEasing,
		setZoomInEasing,
		zoomOutEasing,
		setZoomOutEasing,
		connectedZoomEasing,
		setConnectedZoomEasing,
		showCursor,
		setShowCursor,
		loopCursor,
		setLoopCursor,
		cursorStyle,
		setCursorStyle,
		cursorSize,
		setCursorSize,
		cursorSmoothing,
		setCursorSmoothing,
		cursorSpringStiffnessMultiplier,
		setCursorSpringStiffnessMultiplier,
		cursorSpringDampingMultiplier,
		setCursorSpringDampingMultiplier,
		cursorSpringMassMultiplier,
		setCursorSpringMassMultiplier,
		cameraSpringStiffnessMultiplier,
		setCameraSpringStiffnessMultiplier,
		cameraSpringDampingMultiplier,
		setCameraSpringDampingMultiplier,
		cameraSpringMassMultiplier,
		setCameraSpringMassMultiplier,
		zoomSmoothness,
		setZoomSmoothness,
		zoomClassicMode,
		setZoomClassicMode,
		cursorMotionBlur,
		setCursorMotionBlur,
		cursorClickEffect,
		setCursorClickEffect,
		cursorClickEffectColor,
		setCursorClickEffectColor,
		cursorClickEffectScale,
		setCursorClickEffectScale,
		cursorClickEffectOpacity,
		setCursorClickEffectOpacity,
		cursorClickEffectDurationMs,
		setCursorClickEffectDurationMs,
		cursorClickBounce,
		setCursorClickBounce,
		cursorClickBounceDuration,
		setCursorClickBounceDuration,
		cursorSway,
		setCursorSway,
		borderRadius,
		setBorderRadius,
		padding,
		setPadding,
		cropRegion,
		setCropRegion,
		keycastSettings,
		setKeycastSettings,
	};
}
