**English** · [العربية](README.md)

<p align="center">
  <img src="icons/brand/orax-logo.png" width="300" alt="OraxRecordly">
</p>

# OraxRecordly

An open-source screen recorder and editor for walkthroughs, demos, and product videos, with built-in screenshots and an image editor.

---

## Attribution

OraxRecordly is a fork and derivative of [Recordly](https://github.com/webadderallorg/Recordly) by [@webadderall](https://x.com/webadderall), used under the original project's licence.

The original application, its design, and most of this codebase are the work of the Recordly project and its contributors — this fork does not claim that work as its own. The original licence is kept intact in [LICENSE.md](LICENSE.md) — **AGPL-3.0**.

Because that licence does not permit reusing the "Recordly" name or branding, this fork ships as OraxRecordly.

---

## What this fork changes

Recording, the timeline, cursor tooling, frame styling, and MP4/GIF export are the upstream feature set as-is. What follows is what this fork adds or fixes.

- **Arabic-first UI** with a full RTL layout, and exactly two locales: `ar` and `en`.

- **Screenshots**:
  - Capture the full screen, a selected area, or a selected source, without starting a recording.
  - The global `Ctrl+Alt+A` shortcut works from any app, and can be rebound or disabled in Settings.
  - Capture delay, a file-name template with a live preview, a custom screenshots folder, and PNG or JPEG output.
  - A dashboard library to search captures, reopen them, reveal them in the file manager, and move them to trash.

- **Image editor**: crop, delete region, pen, arrow, shapes, highlight, pixelate, and text, with full undo and lossless saving.

- **Backgrounds from your own machine**: built-in wallpapers, solid colours and gradients, plus automatic discovery of any wallpaper you drop into the wallpapers folder.

- **Recording stop fix**: the Windows capture helper used to re-encode one duplicate frame for every idle gap, so stopping after a static screen took as long as the idle span itself — 20 s of idle meant 23–42 s to stop — and the helper was killed before it could write the file's tail, losing the recording. A stop now takes **0.1–1.3 s regardless of idle length**, and files are an order of magnitude smaller: **a 20 s clip is 3.1 MB instead of 57.9 MB**.

- **Performance work**: code-splitting cut the editor bundle from 1347 kB to 938 kB, and the repeated window-bounds probes during recording are gone.

- **Sign-in and cloud removed**: no account, no cloud sharing, no backend services — the app is fully local.

- **Updates from this repository**: the updater reads this fork's releases only, never the upstream project's.

---

## Download and warning

Download the installer from the [releases page](https://github.com/Mohammedorax/OraxRecordly/releases). On Windows the file is `OraxRecordly-windows-x64.exe`.

> **Note:** the build is not code-signed, so SmartScreen may warn you when you run it. Click **More info**, then **Run anyway**.

**Requirements:** Windows 10 build 19041 or newer, or Windows 11, 64-bit.

---

## Build from source

Prerequisites:

- **Node.js** with npm — a current LTS release.
- **On Windows:** Visual Studio 2022 (or Build Tools) with the **Desktop development with C++** workload, plus **CMake** — needed to build the native `wgc-capture` helper.
- **On macOS:** Xcode Command Line Tools — needed to build the native capture helpers.

```bash
npm ci --ignore-scripts
npm run build:windows-capture   # Windows: build the native WGC capture helper
npm run dev
npm run build:win               # Windows NSIS installer
```

`npm ci --ignore-scripts` installs the exact locked dependency tree without running the `postinstall` hook, which would otherwise rebuild every native helper, so build the helper you need explicitly as shown above. To build for your current platform instead, use `npm run build`; packaged artifacts land in `release/`.

---

## Updates

The app reads releases from this repository, notifies you in-app when an update is available, and installs it only with your approval. See [docs/updates.md](docs/updates.md) for how a release is published.

Installed builds check the releases page once at launch, then carry on with your work without interrupting it.

The user-data folder intentionally stays `%APPDATA%\Recordly` so recordings and settings survive for anyone coming from the original project.

---

## Licence and credits

This project is licensed under **AGPL-3.0**, the same licence as upstream, and the original licence is kept in [LICENSE.md](LICENSE.md). Third-party components and fonts — including the **SA Hazm** typeface used for Arabic text — are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
