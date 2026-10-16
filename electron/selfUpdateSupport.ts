/**
 * Whether this installation can update itself.
 *
 * The updater replaces files inside the app bundle, which only works for the
 * installation shapes it understands. Offering an update that cannot be applied
 * is worse than offering none: the user presses the button, nothing happens, and
 * the app looks broken.
 *
 *   - Windows: the NSIS installer replaces itself; the portable zip does not, so
 *     a portable run is told to download again rather than promised an update.
 *   - macOS: the updater needs a signed bundle. The unsigned disk images we
 *     publish cannot install a signed replacement, so they are excluded too.
 *   - Linux: electron-updater replaces an AppImage. A deb or rpm installation is
 *     owned by the package manager, so those users install the newer package.
 */
import { execFileSync } from "node:child_process";

export interface SelfUpdateEnvironment {
	platform: NodeJS.Platform;
	/** Set by the AppImage runtime when the app runs from an image. */
	appImagePath?: string | undefined;
	/** Set by electron-builder's portable build on Windows. */
	portableExecutableDir?: string | undefined;
	/** macOS: whether the bundle carries a real Developer ID signature. */
	signedBundle?: boolean;
}

export function isSelfUpdateSupported(environment: SelfUpdateEnvironment): boolean {
	if (environment.platform === "linux") {
		return Boolean(environment.appImagePath?.trim());
	}

	if (environment.platform === "darwin") {
		// An ad-hoc signed (or unsigned) bundle cannot be replaced by a notarized
		// update: macOS refuses to install it.
		return environment.signedBundle === true;
	}

	if (environment.platform === "win32") {
		return !environment.portableExecutableDir?.trim();
	}

	return false;
}

/** Reads the environment the app is actually running in. */
export function readSelfUpdateEnvironment(platform = process.platform): SelfUpdateEnvironment {
	if (platform === "darwin") {
		return { platform, signedBundle: hasDeveloperIdSignature() };
	}

	return {
		platform,
		appImagePath: process.env.APPIMAGE,
		portableExecutableDir: process.env.PORTABLE_EXECUTABLE_DIR,
	};
}

/**
 * Whether the running bundle carries a Developer ID signature.
 *
 * `codesign` reports the Team ID for a real Developer ID signature and nothing for
 * an ad-hoc one, which is exactly the distinction that matters: the unsigned
 * builds we publish cannot install a signed replacement, so they must not promise
 * an update they cannot apply.
 */
function hasDeveloperIdSignature(): boolean {
	try {
		const bundle = appBundlePath();
		const output = execFileSync(
			"/bin/sh",
			["-c", `codesign -dv --verbose=4 "${bundle}" 2>&1 || true`],
			// Recordly never shows a console window for a helper process.
			{ windowsHide: true },
		).toString();
		return /TeamIdentifier=[A-Z0-9]{10}/.test(output);
	} catch {
		return false;
	}
}

/** The `.app` directory that contains the running executable. */
function appBundlePath(): string {
	const marker = ".app/Contents/MacOS/";
	const index = process.execPath.indexOf(marker);
	return index === -1 ? process.execPath : process.execPath.slice(0, index + 4);
}
