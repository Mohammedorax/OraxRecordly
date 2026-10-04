# Updates

OraxRecordly updates from **GitHub Releases of your own repository**, never from upstream.

## What a user sees

1. The app checks **once, at launch**, about 15 seconds after start. There is no periodic re-check.
2. If a newer release exists, the app shows a notification (the native "Update Available" dialog, or the update toast on macOS). Nothing is downloaded yet.
3. Only after the user chooses to update does the app download the release.
4. Once the download finishes, the user is offered **Install & Restart**. Nothing is downloaded, installed or restarted without an explicit choice.

The **Help → Check for Updates…** menu item and the in-app check run the same flow on demand: they report "you are up to date" or the actual error when there is nothing to install.

## The feed this fork publishes to

The feed comes from the `app-update.yml` that electron-builder writes into the packaged app, which is generated from the `publish` entry in [`electron-builder.json5`](../electron-builder.json5):

```yaml
owner: Mohammedorax
repo: OraxRecordly
provider: github
publishAutoUpdate: true
updaterCacheDirName: recordly-updater
```

`repository`, `homepage` and `bugs` in [`package.json`](../package.json) point at the same repository. An **explicit** `publish` target is required — omitting it lets electron-builder infer a GitHub publisher from `repository`, which is exactly how a fork's updater ends up pointing at upstream.

A fork that changes the owner or repo must edit the `publish` entry **and** those three `package.json` fields. While the packaged `app-update.yml` still contains the `REPLACE_WITH_GITHUB_` prefix, the updater deliberately stays inert instead of querying a repository that does not exist.

## Publishing a release

Pushing a `v*` tag *is* the release procedure. [`.github/workflows/windows-release.yml`](../.github/workflows/windows-release.yml) builds the Windows installer and publishes the release itself, so `OraxRecordly-windows-x64.exe` and `latest.yml` can never drift apart.

```bash
# 1. Bump the version. It must match the tag exactly or the workflow stops early.
npm pkg set version=1.4.1   # or edit "version" in package.json by hand
git add package.json
git commit -m "Release 1.4.1"
git push origin main

# 2. Tag and push the tag. This starts the release workflow.
git tag v1.4.1
git push origin v1.4.1
```

The workflow then runs on `windows-latest` with Node 22 and:

1. refuses to run unless `github.repository` is `Mohammedorax/OraxRecordly`;
2. fails if the tag does not match `package.json` (`v1.4.1` ↔ `1.4.1`);
3. installs with `npm ci --ignore-scripts`, plus the bundled FFmpeg binary and `npx electron-builder install-app-deps`;
4. builds with the same commands this repo uses locally — `npm run build:platform-native-helpers`, `npx tsc`, `npx vite build`, `npm run normalize:electron-main-cjs`, `npm run smoke:electron-main-cjs`, then `npx electron-builder --win --x64 --publish never`;
5. **fails if `release/latest.yml` or `release/OraxRecordly-windows-x64.exe` is missing**, or if `latest.yml` does not name that installer at the tagged version — a release without usable metadata would silently stop update notifications;
6. publishes the GitHub release with `OraxRecordly-windows-x64.exe`, its `.blockmap`, and `latest.yml`, using the workflow's own `GITHUB_TOKEN` (`permissions: contents: write`, no secrets required).

Installed apps then see the update on their next launch, about 15 seconds in. Nothing about that flow changes: it is still check-at-launch only, notify, download on approval, install on restart.

Notes:

- The release must end up as a normal, published release. A draft or prerelease is invisible to the stable update channel.
- To rebuild an existing tag, run *Actions → Publish Windows Release → Run workflow* with that tag. The workflow updates the existing release's assets.
- Release notes are generated automatically. To write your own, edit the published release's body afterwards in the GitHub UI; do not create the release by hand first, or the workflow has nothing left to create.
- [`release.yml`](../.github/workflows/release.yml) is still the full multi-platform path (signed and notarized macOS, Linux, attestations). It runs when a human *publishes* a release and needs the Apple/Windows signing secrets, so it is not the fork's Windows release path.

## Overrides and escape hatches

- `RECORDLY_UPDATE_FEED` (or the legacy `RECORDLY_UPDATE_FEED_URL`, or the `updateFeedUrl` app setting) points a build at a different feed. It wins over the bundled `app-update.yml`.
- `RECORDLY_DISABLE_AUTO_UPDATES=1` force-disables every check, download and install.
- The updater writes its decisions to `updater.log` in the app's user-data directory; it never logs feed credentials.
