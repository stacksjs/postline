import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import process from 'node:process'
import { Database } from 'bun:sqlite'

const root = join(import.meta.dir, '..')
const readme = await Bun.file(join(root, 'README.md')).text()
const envPath = join(root, '.env')
const databasePath = join(root, 'database/postline.sqlite')
if (await Bun.file(envPath).exists() || await Bun.file(databasePath).exists())
  throw new Error('Run the README check in a fresh checkout without an environment file or workspace database.')

function workspaceOwners(): Array<{ email: string, password: string }> {
  using database = new Database(databasePath, { readonly: true })
  return database.query<{ email: string, password: string }, []>('SELECT email, password FROM users').all()
}

function command(section: 'setup' | 'start' | 'seed'): string {
  const start = readme.indexOf(`<!-- readme-${section} -->`)
  const end = readme.indexOf(`<!-- /readme-${section} -->`)
  const snippet = readme.slice(start, end).match(/```bash\r?\n([\s\S]+?)\r?\n```/)?.[1]
  if (!snippet) throw new Error(`The README is missing the ${section} command.`)
  return snippet
}

const setup = Bun.spawnSync(['bash', '-euc', command('setup')], { cwd: root, stdout: 'inherit', stderr: 'inherit' })
if (setup.exitCode !== 0) throw new Error('The README setup commands failed.')
if (!/^APP_KEY=.+$/m.test(await Bun.file(envPath).text())) throw new Error('The README setup did not create an application key.')
if (workspaceOwners().length) throw new Error('A clean install must leave the workspace available for its first owner.')

const ports = [0, 0, 0].map(() => Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() }))
const [port, apiPort, docsPort] = ports.map(server => String(server.port))
for (const server of ports) server.stop(true)

const { spawnOwnedProcess } = await import('@stacksjs/cli/owned-process')
const dev = spawnOwnedProcess(['bash', '-euc', command('start')], {
  cwd: root,
  env: { ...process.env, CI: 'true', PORT: port, PORT_API: apiPort, PORT_DOCS: docsPort },
  stdout: 'inherit',
  stderr: 'inherit',
})

const origin = `http://127.0.0.1:${port}`
const finished = new AbortController()
async function checkStartup(): Promise<void> {
  const deadline = Date.now() + 120_000
  let loginReady = false
  while (!finished.signal.aborted && Date.now() < deadline) {
    if (!loginReady) {
      const login = await fetch(`${origin}/login`, { signal: AbortSignal.timeout(20_000) }).catch(() => null)
      if (login?.ok) {
        if (!(await login.text()).includes('Create the workspace account'))
          throw new Error('The fresh workspace did not show first-run registration.')
        loginReady = true
      }
    }
    const health = await fetch(`${origin}/api/postline/health`, { signal: AbortSignal.timeout(3000) })
      .then(async response => response.ok ? response.json() : null).catch(() => null)
    if (loginReady && health?.database === 'ok' && health?.migrations === 'ok' && health?.scheduler === 'ok') {
      console.log('The README started a fresh workspace with a migrated database and a live scheduler.')
      return
    }
    await Bun.sleep(500)
  }
  if (!finished.signal.aborted) throw new Error('The README dev command did not start a healthy workspace within two minutes.')
}

try {
  await Promise.race([
    checkStartup(),
    dev.exited.then(({ code }) => { throw new Error(`The README dev command stopped with status ${code}.`) }),
  ])
}
finally {
  finished.abort()
  await dev.stop()
}

const password = randomBytes(18).toString('base64url')
const seed = Bun.spawnSync(['bash', '-euc', command('seed')], {
  cwd: root,
  env: { ...process.env, SEED_USER_PASSWORD: password },
  stdout: 'inherit',
  stderr: 'inherit',
})
if (seed.exitCode !== 0) throw new Error('The README development seed command failed.')

const [owner, extra] = workspaceOwners()
if (!owner || extra || owner.email !== 'dev@postline.test' || !await Bun.password.verify(password, owner.password))
  throw new Error('The development seed did not create the documented workspace account with the supplied password.')
