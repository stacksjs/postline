/**
 * The Open Times desktop launcher.
 *
 * `buddy build:desktop` compiles this file into the bundle's main executable in
 * place of the framework's generic launcher, which opens the manifest URL in a
 * plain titled window. That is the wrong shape for this app in two ways:
 *
 * - The workspace layout (resources/layouts/app.stx) is drawn for Craft's
 *   hidden-titlebar mode: the sidebar runs to the top edge and the window
 *   buttons, sidebar toggle and history arrows sit over it. A system titlebar
 *   above that is a second, empty title row.
 * - Without --persistent-storage the webview keeps cookies in memory only, so
 *   the auth-token cookie the login page sets dies with the process and every
 *   launch starts signed out.
 *
 * Everything else is read from desktop.json, which build:desktop writes next to
 * the runtime, so the URL stays a build-time input (DESKTOP_URL) rather than
 * something compiled in here.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'

interface DesktopManifest {
  url: string
  title: string
  width: number
  height: number
  darkMode?: boolean
}

/**
 * Where the window opens. `build:desktop` resolves the manifest URL as
 * `DESKTOP_URL || APP_URL` and has no notion of an app path, so a manifest
 * carrying only an origin opens `/` — the public marketing page, in a window
 * whose chrome the marketing layout is not drawn for. `config/app.ts` used to
 * declare an `appPath` for this and nothing ever read it.
 *
 * Setting DESKTOP_URL fixes one machine; `.env` is untracked, so everyone else
 * still gets the landing page. Defaulting here fixes every build, and an
 * explicit path in DESKTOP_URL still wins.
 */
const WORKSPACE_PATH = '/composer'

function windowUrl(raw: string): string {
  try {
    const url = new URL(raw)
    if (url.pathname === '/' && !url.search && !url.hash)
      url.pathname = WORKSPACE_PATH
    return url.toString()
  }
  catch {
    // Not parseable as a URL: hand it to Craft unchanged and let it complain,
    // rather than silently rewriting something we did not understand.
    return raw
  }
}

const executableDir = dirname(process.execPath)

// Inside a .app bundle the manifest lives in Contents/Resources; in the raw
// build:desktop output it sits beside the executable.
const manifestPath = [join(executableDir, '..', 'Resources', 'desktop.json'), join(executableDir, 'desktop.json')]
  .find(candidate => existsSync(candidate)) ?? join(executableDir, 'desktop.json')
const runtimePath = join(executableDir, process.platform === 'win32' ? 'craft-runtime.exe' : 'craft-runtime')

if (!existsSync(manifestPath))
  throw new Error(`Desktop manifest not found: ${manifestPath}`)
if (!existsSync(runtimePath))
  throw new Error(`Craft runtime not found: ${runtimePath}`)

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as DesktopManifest

const args = [
  runtimePath,
  windowUrl(manifest.url),
  '--title',
  manifest.title,
  // Without this macOS names the menu bar, and the About/Hide/Quit items in
  // it, after the executable — so the app shipped calling itself
  // "craft-runtime". --title only sets the window's own title bar, which this
  // app hides anyway.
  '--app-name',
  manifest.title,
  '--width',
  String(manifest.width),
  '--height',
  String(manifest.height),
  '--titlebar-hidden',
  // Native sidebar material behind the web sidebar, at the width the layout
  // reserves for it (--ot-sidebar-width).
  '--web-sidebar-material',
  '--web-sidebar-width',
  '286',
  '--persistent-storage',
  // The layout draws its own sidebar toggle and history arrows beside the
  // window buttons (data-native-shell-control); Craft's would be a second set.
  '--no-web-chrome-controls',
  '--no-devtools',
]

if (manifest.darkMode)
  args.push('--dark')

const runtime = Bun.spawn(args, { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
process.exit(await runtime.exited)
