# Desktop app

The Open Times ships as a native macOS app: a [Craft](https://github.com/craft-native/craft)
window around the deployed workspace (`https://theopentimes.org/composer`).
Sign-in persists between launches, and the window uses the layout's own
sidebar and window controls.

| File | What it is |
|---|---|
| `app/Desktop/launcher.ts` | The bundle's main executable: starts Craft with the hidden titlebar, sidebar material and persistent storage |
| `app/Desktop/icon.svg` | Source of the app icon |
| `app/Desktop/AppIcon.icns` | The icon the App Store build embeds |
| `resources/assets/images/app-icon.png` | The icon the DMG build converts into an `.icns` |
| `app/Desktop/Info.plist.json` | Extra Info.plist keys for the DMG build (category, encryption declaration) |
| `.github/workflows/release.yml` | Builds the DMG for every release tag |
| `.github/workflows/apple-app-store.yml` | Mac App Store packaging and upload (manual) |

## Build locally

```bash
export CRAFT_BIN=~/Code/Tools/craft/packages/zig/zig-out/bin/craft
export DESKTOP_URL=https://theopentimes.org/composer
./buddy build:desktop
./buddy build:dmg
```

The DMG lands in `storage/framework/desktop-dmg/`. Use `DESKTOP_URL=http://theopentimes.localhost/composer`
to wrap a local dev server instead. On loopback the workspace lets the desktop
shell in without signing in.

## Releases

```bash
bun run release:patch
```

This bumps `package.json`, writes the changelog, commits, then tags `vX.Y.Z` and
pushes. The tag triggers `release.yml`, which builds the app on macOS
(Apple Silicon) and attaches `The-Open-Times-X.Y.Z-macos-arm64.dmg.zip`
and its checksum to the GitHub release.

The DMG is unsigned until you set the repository variables
`DESKTOP_SIGNING_IDENTITY` (a Developer ID Application identity) and
`DESKTOP_NOTARY_PROFILE`. Unsigned, the app needs a right-click → Open the
first time.

## Mac App Store

1. Enroll in the Apple Developer Program and register the bundle id
   `org.theopentimes.desktop`, or your own, set as `APPLE_BUNDLE_ID`.
2. Create the app record in App Store Connect, then fill in the pricing, privacy,
   age rating and export-compliance answers.
3. Add the repository secrets and variables listed at the top of
   `.github/workflows/apple-app-store.yml`.
4. Run **Publish Mac App Store** from the Actions tab against a release tag,
   with *validate-only* on. When it passes, run it again with it off to upload.

Review note: Apple's guideline 4.2 (minimum functionality) is strict with apps
that only wrap a website. The persistent session and native window chrome
help, but native features are what make the case at review. Notifications for
scheduled posts and the inbox are the obvious next ones.
