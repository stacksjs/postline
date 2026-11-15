# Desktop app

Postline ships as a native macOS app: a [Craft](https://github.com/craft-native/craft)
window around a running Postline. Sign-in persists between launches, and the
window uses the layout's own sidebar and window controls.

**The app opens an address; it does not contain the server.** `DESKTOP_URL` is
the Postline it opens, and it is a build-time input. A release build needs a
deployed Postline to point at. Bundling the server into the app, so it runs
with nothing deployed, is the next step for this app and is not done yet (see
"What is not done" below).

| File | What it is |
|---|---|
| `app/Desktop/launcher.ts` | The bundle's main executable: starts Craft with the hidden titlebar, sidebar material and persistent storage |
| `app/Desktop/icon.svg` | The icon, as a drawing |
| `scripts/app-icon.ts` | Draws the icon PNGs: `bun scripts/app-icon.ts` |
| `resources/assets/images/app-icon.png` | The icon the DMG build converts into an `.icns` |
| `app/Desktop/AppIcon.icns` | The icon the App Store build embeds |
| `app/Desktop/Info.plist.json` | Extra Info.plist keys for the DMG build (category, encryption declaration) |
| `.github/workflows/release.yml` | Builds the DMG for a release tag and publishes the GitHub release |
| `.github/workflows/apple-app-store.yml` | Mac App Store packaging and upload (manual) |

## Build locally

You need a Craft binary. Point `CRAFT_BIN` at one, or have `craft` on your `PATH`.

```bash
export DESKTOP_URL=https://your-postline.example.com/composer
```

```bash
./buddy build:desktop
```

```bash
./buddy build:dmg
```

The DMG lands in `storage/framework/desktop-dmg/`. Use
`DESKTOP_URL=http://postline.localhost/composer` to wrap a local dev server
instead. On loopback the workspace lets the desktop shell in without signing in.

`DESKTOP_APP_NAME`, `DESKTOP_BUNDLE_ID` and `DESKTOP_APP_VERSION` override the
name, bundle id and version; they default to `APP_NAME`, `sh.stacks.<name>` and
the version in `package.json`.

## Regenerate the icon

```bash
bun scripts/app-icon.ts
```

That rewrites `resources/assets/images/app-icon.png` and the touch icons. To
rebuild `app/Desktop/AppIcon.icns` from it, make an iconset with `sips` at
16, 32, 128, 256 and 512 points (each at 1x and 2x) and run
`iconutil -c icns <name>.iconset -o app/Desktop/AppIcon.icns`.

## Releases

Before the first release, set the repository variable `DESKTOP_URL` to the
`https` address of the Postline the app should open. The release workflow stops
with an error when it is missing.

```bash
bun run release:minor
```

This bumps `package.json`, writes the changelog, commits, then tags `vX.Y.Z` and
pushes. The tag triggers `release.yml`, which builds the app on macOS
(Apple Silicon) and uses the [Pantry](https://github.com/pantry-pm/pantry)
action to publish the GitHub release: notes from that version's section of
`CHANGELOG.md`, `Postline-X.Y.Z-macos-arm64.dmg`, and a checksums file.

The DMG is unsigned until you set the repository variables
`DESKTOP_SIGNING_IDENTITY` (a Developer ID Application identity) and
`DESKTOP_NOTARY_PROFILE`. Unsigned, the app needs a right-click, then Open, the
first time.

## Mac App Store

1. Enroll in the Apple Developer Program and register the bundle id
   `org.stacksjs.postline`, or your own, set as `APPLE_BUNDLE_ID`.
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

## What is not done

- **The app is not self-contained.** It needs a Postline reachable at
  `DESKTOP_URL`. Stacks has a desktop mode that compiles the server into the
  app and serves it on loopback (`config/desktop.ts` with a `webview` section,
  `buddy release:desktop`); moving to it means running migrations, generating
  the app key and running the scheduler inside the app on first launch.
- **No signed updates.** That arrives with the `webview` mode above.
- **Apple Silicon only.** The release workflow builds `arm64`. The App Store
  workflow builds a universal binary.
