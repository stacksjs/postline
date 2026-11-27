import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fetchCraftRuntime, installedCraftVersion } from '@stacksjs/desktop-build'

const root = join(import.meta.dir, '..')
const version = installedCraftVersion(root)
if (!version) throw new Error('Install the locked Craft SDK before building Postline.')

const runtimeDirectory = await mkdtemp(join(tmpdir(), 'postline-craft-release-'))
try {
  // Use the verified archive for the SDK in bun.lock even when another Craft
  // version is installed on the release machine.
  const runtime = await fetchCraftRuntime({ target: 'darwin-arm64', version, directory: runtimeDirectory })
  const build = Bun.spawn([process.execPath, 'node_modules/@stacksjs/buddy/dist/cli.js', 'build:desktop', '--target', 'darwin-arm64'], {
    cwd: root,
    env: { ...process.env, CRAFT_BIN_DARWIN_ARM64: runtime.binary },
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if (await build.exited !== 0) throw new Error('The Postline desktop build failed.')

  const bundled = join(root, 'storage/framework/desktop/webview/darwin-arm64/Postline.app/Contents/MacOS/craft-runtime')
  const probe = Bun.spawnSync([bundled, '--version'], { cwd: root, stderr: 'inherit' })
  const firstLine = probe.stdout.toString().split('\n', 1)[0]?.trim()
  if (probe.exitCode !== 0 || firstLine !== `craft version ${version}`)
    throw new Error(`Expected the app to bundle Craft ${version}, got ${firstLine || 'no version'}.`)
  console.log(`Verified bundled Craft ${version}.`)
}
finally {
  await rm(runtimeDirectory, { recursive: true, force: true })
}
