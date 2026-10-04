/**
 * URLs for files served out of `public/`.
 *
 * `import.meta.env.BASE_URL` is "/" in the Vite dev server and "./" in the
 * packaged build (`vite-plugin-electron` sets `base: "./"`). Resolving the icon
 * through it therefore yields "/app-icons/..." while developing and
 * "./app-icons/..." under `file://`; a bare "/app-icons/..." would resolve to
 * the drive root in the packaged app and 404.
 */
export const APP_ICON_128_SRC = `${import.meta.env.BASE_URL}app-icons/recordly-128.png`;
