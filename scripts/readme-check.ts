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

type Section = 'bootstrap' | 'setup' | 'start' | 'seed' | 'serve' | 'marketing-start' | 'marketing-build'

function command(section: Section): string {
  const start = readme.indexOf(`<!-- readme-${section} -->`)
  const end = readme.indexOf(`<!-- /readme-${section} -->`)
  const snippet = start >= 0 && end > start ? readme.slice(start, end).match(/```bash\r?\n([\s\S]+?)\r?\n```/)?.[1] : undefined
  if (!snippet) throw new Error(`The README is missing the ${section} command.`)
  return snippet
}

function run(section: Section, env = process.env): void {
  const child = Bun.spawnSync(['bash', '-euc', command(section)], { cwd: root, env, stdout: 'inherit', stderr: 'inherit' })
  if (child.exitCode !== 0) throw new Error(`The README ${section} commands failed.`)
}

const setup = process.argv.includes('--bootstrap') ? 'bootstrap' : 'setup'
run(setup)
if (!/^APP_KEY=.+$/m.test(await Bun.file(envPath).text())) throw new Error('The README setup did not create an application key.')
if (workspaceOwners().length) throw new Error('A clean install must leave the workspace available for its first owner.')
if (setup === 'bootstrap') {
  console.log('The README bootstrap installed the toolchain and migrated the workspace for first-run registration.')
  process.exit(0)
}

const ports = [0, 0, 0].map(() => Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() }))
const [port, apiPort, docsPort] = ports.map(server => String(server.port))
for (const server of ports) server.stop(true)

const { spawnOwnedProcess } = await import('@stacksjs/cli/owned-process')
const env = { ...process.env, CI: 'true', PORT: port, PORT_API: apiPort, PORT_DOCS: docsPort }
const origin = `http://127.0.0.1:${port}`

async function withServices(name: string, commands: string[], check: (signal: AbortSignal) => Promise<void>, overrides: Record<string, string> = {}): Promise<void> {
  const finished = new AbortController()
  const services: Array<ReturnType<typeof spawnOwnedProcess>> = []
  try {
    for (const line of commands) {
      services.push(spawnOwnedProcess(['bash', '-euc', line], {
        cwd: root,
        env: { ...env, ...overrides },
        stdout: 'inherit',
        stderr: 'inherit',
      }))
    }
    await Promise.race([
      check(finished.signal),
      ...services.map((service, index) => service.exited.then(({ code }) => {
        throw new Error(`README ${name} command ${commands[index]} stopped with status ${code}.`)
      })),
    ])
  }
  finally {
    finished.abort()
    await Promise.all(services.map(service => service.stop()))
  }
}

async function waitUntil(name: string, signal: AbortSignal, ready: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 120_000
  while (!signal.aborted && Date.now() < deadline) {
    if (await ready()) return
    await Bun.sleep(500)
  }
  if (!signal.aborted) throw new Error(`The README ${name} did not become ready within two minutes.`)
}

function page(path: string) {
  return fetch(`${origin}${path}`, { signal: AbortSignal.timeout(8_000) }).catch(() => null)
}

async function healthy(): Promise<boolean> {
  const health = await page('/api/postline/health').then(async response => response?.ok ? response.json() : null).catch(() => null)
  return health?.database === 'ok' && health?.migrations === 'ok' && health?.scheduler === 'ok'
}

await withServices('dev', [command('start')], async (signal) => {
  await waitUntil('first-run page', signal, async () => {
    const [setupPage, availability] = await Promise.all([page('/setup'), page('/api/postline/setup/availability')])
    if (!setupPage?.ok || !availability?.ok) return false
    if (!(await setupPage.text()).includes('Set up your workspace') || !(await availability.json()).data?.available)
      throw new Error('The fresh workspace did not offer first-run setup.')
    return true
  })
  await waitUntil('development scheduler', signal, healthy)
  console.log('The README started a fresh workspace with a migrated database and a live scheduler.')
})

const password = randomBytes(18).toString('base64url')
run('seed', { ...process.env, SEED_USER_PASSWORD: password })
const [owner, extra] = workspaceOwners()
if (!owner || extra || owner.email !== 'dev@postline.test' || !await Bun.password.verify(password, owner.password))
  throw new Error('The development seed did not create the documented workspace account with the supplied password.')

function publishRuns(): number {
  using database = new Database(databasePath, { readonly: true })
  return database.query<{ runs: number }, []>("SELECT runs FROM job_heartbeats WHERE job = 'PublishScheduledPosts'").get()?.runs ?? 0
}

const previousRuns = publishRuns()
await withServices('source server', command('serve').split(/\r?\n/), async (signal) => {
  await waitUntil('production sign-in', signal, async () => {
    const login = await page('/login')
    return Boolean(login?.ok && (await login.text()).includes('Sign in to Postline'))
  })
  await waitUntil('standalone scheduler and API', signal, async () => publishRuns() > previousRuns && await healthy())
  const connection = await page('/api/postline/workspace/connection')
  const identity = connection?.ok ? await connection.json() : null
  if (identity?.product !== 'postline' || identity.protocol !== 1)
    throw new Error('A phone could not verify the workspace started from the README.')
  console.log('The README started the web server, API and a separate scheduler.')
}, { APP_ENV: 'production', APP_URL: 'localhost' })

await withServices('marketing dev', [command('marketing-start')], async (signal) => {
  await waitUntil('marketing landing page', signal, async () => {
    const landing = await page('/')
    return Boolean(landing?.ok && (await landing.text()).includes('Write it once. Publish it'))
  })
  await waitUntil('marketing workspace verification', signal, async () => {
    const connection = await page('/api/postline/workspace/connection')
    if (!connection || connection.status >= 500) return false
    if (connection.status !== 404)
      throw new Error('The marketing site offered a workspace connection.')
    return true
  })
  console.log('The README marketing command served the public landing page.')
}, { APP_URL: 'localhost' })

run('marketing-build')
const generated = Bun.spawnSync(['git', 'status', '--porcelain', '--untracked-files=all', '--', 'resources/views/features', 'resources/views/use-cases', 'public/images/og'], { cwd: root, stderr: 'inherit' })
if (generated.exitCode !== 0) throw new Error('Could not check the generated marketing files.')
const changes = generated.stdout.toString().trim()
if (changes) throw new Error('Regenerate and commit these marketing files.\n' + changes)
