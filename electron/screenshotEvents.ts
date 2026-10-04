/**
 * Channel and event names shared by the screenshot system.
 *
 * Kept dependency-free (no electron/fs imports) because the preload script, the
 * main process and the region-selector renderer all reference the same strings.
 */

/** Invoke channels (renderer -> main, Promise). */
export const SCREENSHOT_CAPTURE_FULL_SCREEN_CHANNEL = "capture-screenshot-full-screen";
export const SCREENSHOT_CAPTURE_REGION_CHANNEL = "capture-screenshot-region";
export const SCREENSHOT_CAPTURE_SELECTED_SOURCE_CHANNEL = "capture-screenshot";
export const SCREENSHOT_OPEN_IMAGE_EDITOR_CHANNEL = "open-image-editor";
export const SCREENSHOT_READ_IMAGE_FILE_CHANNEL = "read-image-file";
export const SCREENSHOT_WRITE_IMAGE_FILE_CHANNEL = "write-image-file";

/** Send channels (renderer -> main, fire and forget). */
export const SCREENSHOT_REGION_COMPLETE_CHANNEL = "screenshot-region-complete";
export const SCREENSHOT_REGION_CANCEL_CHANNEL = "screenshot-region-cancel";
/**
 * Keeps the overlay's safety timer honest: the region selector reports its own
 * pointer/key activity on this channel so the main process can reset a timeout
 * that is meant to catch a hung overlay, not a slow user.
 */
export const SCREENSHOT_REGION_ACTIVITY_CHANNEL = "screenshot-region-activity";

/** Event channels (main -> renderer). */
export const SCREENSHOT_REGION_READY_EVENT = "screenshot-region-ready";
export const SCREENSHOT_EDITOR_LOAD_IMAGE_EVENT = "image-editor-load-image";

export const SCREENSHOT_PREFERENCES_GET_CHANNEL = "get-screenshot-preferences";
export const SCREENSHOT_PREFERENCES_SET_CHANNEL = "set-screenshot-preferences";

/** Screenshots folder: resolve it, or open it in the OS file manager. */
export const SCREENSHOT_GET_FOLDER_CHANNEL = "get-screenshots-folder";
export const SCREENSHOT_OPEN_FOLDER_CHANNEL = "open-screenshots-folder";
/** Open the native directory picker and persist the chosen screenshots folder. */
export const SCREENSHOT_CHOOSE_FOLDER_CHANNEL = "choose-screenshots-folder";
