/**
 * Playback promises reject for two very different reasons.
 *
 * A source that cannot be decoded is a real failure the editor must report. A
 * `play()` interrupted by a `pause()` or a seek is not: the browser rejects with
 * `AbortError` ("The play() request was interrupted by a call to pause()") every
 * time the user pauses, seeks, or an export finishes and restores playback.
 * Reporting those as editor errors replaced the whole editor with an error
 * screen after a successful export.
 */

const BENIGN_PLAYBACK_MESSAGES = [
	"interrupted by a call to pause",
	"interrupted by a call to seek",
	"the play() request was interrupted",
	"the request was aborted",
	"aborterror",
] as const;

/** True when a rejected play()/media promise is expected control flow. */
export function isBenignPlaybackInterruption(error: unknown): boolean {
	const name =
		error && typeof error === "object" && "name" in error
			? String((error as { name?: unknown }).name ?? "")
			: "";
	if (name.toLowerCase() === "aborterror") {
		return true;
	}

	const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
	const normalized = message.toLowerCase();
	return BENIGN_PLAYBACK_MESSAGES.some((marker) => normalized.includes(marker));
}
