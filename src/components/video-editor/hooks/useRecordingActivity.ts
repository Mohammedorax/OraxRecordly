import { useEffect, useState } from "react";

/**
 * True while a screen recording is in progress.
 *
 * The editor keeps its Pixi preview ticking at the display refresh rate. While
 * the capture helper is encoding frames that preview competes for the same GPU
 * and CPU, which is exactly when users report stutter and an unresponsive
 * machine. The editor only needs to know *that* a recording is running so it can
 * stop drawing; the recording itself lives in its own window.
 */
type RecordingStateListener = (recording: boolean) => void;
type RecordingStatePayload = { recording: boolean; sourceName: string };
type RecordingStateSubscribe = (
	listener: (state: RecordingStatePayload) => void,
) => (() => void) | undefined;

/**
 * Wires a raw subscription to a listener, tolerating a missing bridge. Extracted
 * so the behaviour is testable without a DOM.
 */
export function subscribeToRecordingActivity(
	subscribe: RecordingStateSubscribe | undefined,
	onStateChange: RecordingStateListener,
): () => void {
	if (typeof subscribe !== "function") {
		return () => undefined;
	}

	const unsubscribe = subscribe((state) => onStateChange(Boolean(state?.recording)));
	return () => {
		unsubscribe?.();
	};
}

export function useRecordingActivity(): boolean {
	const [isRecording, setIsRecording] = useState(false);

	useEffect(
		() =>
			subscribeToRecordingActivity(
				window.electronAPI?.onRecordingStateChanged,
				setIsRecording,
			),
		[],
	);

	return isRecording;
}
