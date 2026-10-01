import fs from "node:fs/promises";
import path from "node:path";
import { RECORDING_SESSION_MANIFEST_SUFFIX } from "../constants";
import type { RecordingSessionData, RecordingSessionManifest } from "../types";
import { normalizeVideoSourcePath, parseJsonWithByteOrderMark } from "../utils";

export function getRecordingSessionManifestPath(videoPath: string) {
	const extension = path.extname(videoPath);
	const baseName = path.basename(videoPath, extension);
	return path.join(path.dirname(videoPath), `${baseName}${RECORDING_SESSION_MANIFEST_SUFFIX}`);
}

export async function persistRecordingSessionManifest(
	session: RecordingSessionData,
): Promise<void> {
	const normalizedVideoPath = normalizeVideoSourcePath(session.videoPath);
	if (!normalizedVideoPath) {
		return;
	}

	const manifestPath = getRecordingSessionManifestPath(normalizedVideoPath);
	const manifest: RecordingSessionManifest = {
		version: 2,
		videoFileName: path.basename(normalizedVideoPath),
	};

	await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
}

export async function resolveRecordingSessionManifest(
	videoPath?: string | null,
): Promise<RecordingSessionData | null> {
	const normalizedVideoPath = normalizeVideoSourcePath(videoPath);
	if (!normalizedVideoPath) {
		return null;
	}

	const manifestPath = getRecordingSessionManifestPath(normalizedVideoPath);

	try {
		const content = await fs.readFile(manifestPath, "utf-8");
		// Manifests written by older versions may still carry webcam metadata.
		// Unknown keys are ignored so those files keep resolving.
		const parsed = parseJsonWithByteOrderMark<Partial<RecordingSessionManifest>>(content);
		if (parsed.version !== 1 && parsed.version !== 2) {
			return null;
		}

		return { videoPath: normalizedVideoPath };
	} catch {
		return null;
	}
}

export async function resolveRecordingSession(
	videoPath?: string | null,
): Promise<RecordingSessionData | null> {
	const manifestSession = await resolveRecordingSessionManifest(videoPath);
	if (manifestSession) {
		return manifestSession;
	}

	const normalizedVideoPath = normalizeVideoSourcePath(videoPath);
	if (!normalizedVideoPath) {
		return null;
	}

	return { videoPath: normalizedVideoPath };
}
