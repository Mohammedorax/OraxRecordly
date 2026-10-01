# Updates

OraxRecordly updates from **GitHub Releases of your own repository**, never from upstream.

## What a user sees

1. The app checks **once, at launch**, about 15 seconds after start. There is no periodic re-check.
2. If a newer release exists, the app shows a notification (the native "Update Available" dialog, or the update toast on macOS). Nothing is downloaded yet.
3. Only after the user chooses to update does the app download the release.
4. Once the download finishes, the user is offered **Install & Restart**. Nothing is downloaded, installed or restarted without an explicit choice.

The **Help → Check for Updates…** menu item and the in-app check run the same flow on demand: they report "you are up to date" or the actual error when there is nothing to install.

## The two values a fork must edit

The feed comes from the `app-update.yml` that electron-builder writes into the packaged app, which is generated from the `publish` entry in [`electron-builder.json5`](../electron-builder.json5). Replace both placeholders there:

| Placeholder | Replace with |
| --- | --- |
| `REPLACE_WITH_GITHUB_OWNER` | your GitHub user or organization |
| `REPLACE_WITH_GITHUB_REPO` | your repository name |

Then point the matching metadata in [`package.json`](../package.json) at the same repository: `repository`, `homepage` and `bugs`.

While the placeholders are still present in the packaged `app-update.yml`, the updater deliberately stays inert instead of querying a repository that does not exist. An **explicit** `publish` target is required — omitting it lets electron-builder infer a GitHub publisher from `repository`, which is exactly how a fork's updater ends up pointing at upstream.

## Publishing a release

1. Bump `version` in `package.json`.
2. Build for each platform (`npm run build:win`, `npm run build:mac`, `npm run build:linux`).
3. Publish the installers **and** the generated update metadata (`latest.yml`, `*.blockmap`, and on macOS the `*.zip`) to the GitHub release for the new tag, for example:

   ```bash
   npx electron-builder --publish always   # needs GH_TOKEN
   ```

   `npm run release:create -- --tag v1.4.1` creates the release itself; a draft or prerelease is ignored by the stable channel until it is published.

## Overrides and escape hatches

- `RECORDLY_UPDATE_FEED` (or the legacy `RECORDLY_UPDATE_FEED_URL`, or the `updateFeedUrl` app setting) points a build at a different feed. It wins over the bundled `app-update.yml`.
- `RECORDLY_DISABLE_AUTO_UPDATES=1` force-disables every check, download and install.
- The updater writes its decisions to `updater.log` in the app's user-data directory; it never logs feed credentials.
