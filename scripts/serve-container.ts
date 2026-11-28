import { randomBytes } from 'node:crypto'
import { link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { spawnOwnedProcess } from '@stacksjs/cli/owned-process'
import { workspaceKeyBytes } from '../app/Support/Security/workspace-key'

const data = '/var/lib/postline'
const keyPath = join(data, 'app-key')
const buddy = 'node_modules/@stacksjs/buddy/dist/cli.js'

async function workspaceKey(initialize = true): Promise<string> {
  const configured = process.env.APP_KEY?.trim()
  if (configured && !workspaceKeyBytes(configured)) throw new Error('APP_KEY is invalid. Supply the original workspace key or let a new volume generate one.')
  const read = () => readFile(keyPath, 'utf8').then(key => key.trim()).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return undefined
  })

  let saved = await read()
  if (saved === undefined && initialize) {
    const stage = await mkdtemp(join(data, '.key-'))
    try {
      const candidate = join(stage, 'app-key')
      await writeFile(candidate, configured || `base64:${randomBytes(32).toString('base64')}`, { mode: 0o600 })
      await link(candidate, keyPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
      })
      saved = await read()
    }
    finally {
      await rm(stage, { recursive: true, force: true })
    }
  }

  if (!saved || !workspaceKeyBytes(saved)) throw new Error('The volume needs a valid application key. Restore the original key from your backup.')
  if (configured && configured !== saved) throw new Error('APP_KEY differs from the existing workspace key in the volume.')
  return saved
}

// docker exec does not inherit the key loaded by the container's entrypoint.
// Administrative commands use the existing volume key without initializing it.
if (process.argv[2] === 'buddy') {
  const cli = Bun.spawn([process.execPath, buddy, ...process.argv.slice(3)], {
    env: { ...process.env, APP_KEY: await workspaceKey(false) },
    stdin: 'inherit', stdout: 'inherit', stderr: 'inherit',
  })
  process.exit(await cli.exited)
}

await mkdir(join(data, 'media'), { recursive: true, mode: 0o700 })
await mkdir(join(data, 'blog'), { recursive: true, mode: 0o700 })
const env = { ...process.env, APP_KEY: await workspaceKey() }
const migrate = Bun.spawn([process.execPath, 'scripts/migrate-workspace.ts'], { env, stdout: 'inherit', stderr: 'inherit' })
if (await migrate.exited !== 0) throw new Error('The workspace database did not migrate.')

const services = [
  { name: 'web', command: [process.execPath, 'node_modules/@stacksjs/buddy/dist/serve-entry.js'], env: { HOST: '0.0.0.0' } },
  { name: 'api', command: [process.execPath, 'node_modules/@stacksjs/actions/dist/serve/api.js'], env: { HOST: '127.0.0.1', PORT: process.env.PORT_API } },
  { name: 'scheduler', command: [process.execPath, buddy, 'schedule:run'], env: {} },
]
const shutdown = Promise.withResolvers<void>()
process.once('SIGINT', shutdown.resolve)
process.once('SIGTERM', shutdown.resolve)
const children = services.map(({ name, command, env: serviceEnv }) => ({
  name,
  process: spawnOwnedProcess(command, { env: { ...env, ...serviceEnv }, stdout: 'inherit', stderr: 'inherit' }),
}))

try {
  await Promise.all(children.map(child => child.process.started))
  const stopped = await Promise.race([
    shutdown.promise,
    ...children.map(async child => ({ name: child.name, ...await child.process.exited })),
  ])
  if (stopped) throw new Error(`The ${stopped.name} service stopped (${stopped.signal ?? stopped.code}).`)
}
finally {
  await Promise.all(children.map(child => child.process.stop()))
}
