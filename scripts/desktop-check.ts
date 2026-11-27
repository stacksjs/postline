/**
 * Build a headless smoke executable with the same Stacks bundle collectors
 * and runtime launcher as the Mac app, then run it from a fresh directory.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { appBundleFiles, appClientScripts, appConfigFiles, appMigrationFiles } from '@stacksjs/actions/build/macos-native'
import { collectViewFiles, desktopLauncherCompileArgs, renderWebviewEntry } from '@stacksjs/desktop-build'
import desktop from '../config/desktop'

const root = join(import.meta.dir, '..')
const scratch = mkdtempSync(join(tmpdir(), 'postline-desktop-check-'))
const { appName, appId, window, agent } = desktop.webview

try {
  const agentEntry = join(root, agent.entry)
  const views = join(scratch, 'views')
  const buildViews = Bun.spawn([process.execPath, 'app/Desktop/build-views.ts'], {
    cwd: root, env: { ...process.env, DESKTOP_VIEWS_OUT: views }, stdout: 'inherit', stderr: 'inherit',
  })
  if (await buildViews.exited !== 0) throw new Error('Could not build the bundled desktop views.')
  const [app, scripts, migrations] = await Promise.all([
    appBundleFiles(root, [agentEntry]),
    appClientScripts(root, join(scratch, 'client-scripts')),
    appMigrationFiles(root),
  ])
  const entry = join(scratch, 'entry.ts')
  writeFileSync(entry, renderWebviewEntry({
    manifest: {
      appName,
      appId,
      version: '0.0.0',
      runtime: process.execPath,
      window: { title: appName, ...window },
      startPath: agent.startPath,
    },
    agentEntry,
    prepareEntry: join(root, agent.prepare),
    ...app,
    viewFiles: { ...collectViewFiles(views), ...scripts },
    migrations,
    databaseFilename: agent.database.filename,
    configFiles: appConfigFiles(root),
    migrationRunner: fileURLToPath(import.meta.resolve('@stacksjs/database/compiled-migrations')),
    launcherModule: join(root, 'tests/support/desktop-smoke.ts'),
  }))

  const outfile = join(scratch, 'postline-check')
  const compile = Bun.spawn([process.execPath, ...desktopLauncherCompileArgs({ entry, outfile })], {
    cwd: root, stdout: 'inherit', stderr: 'inherit',
  })
  if (await compile.exited !== 0) throw new Error('Could not compile the desktop check.')
  // The launcher sets its own workspace and keys. A checkout's OAuth
  // redirects and other application settings must not leak into the fixture.
  const run = Bun.spawn([outfile], {
    cwd: scratch, env: { PATH: process.env.PATH }, stdout: 'inherit', stderr: 'inherit',
  })
  if (await run.exited !== 0) throw new Error('The compiled desktop check failed.')
}
finally {
  rmSync(scratch, { recursive: true, force: true })
}
