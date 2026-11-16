/**
 * Write what the desktop agent carries inside its compiled binary:
 * `app/Desktop/bundle.generated.js` and `app/Desktop/database.template.sqlite`.
 *
 * The Mac app runs Postline's own API inside itself. Its agent is one compiled
 * binary with no project tree beside it, and the framework finds route files,
 * `'Actions/...'` handlers, middleware, jobs and migrations by reading them
 * off disk, which a compiled binary cannot do. So they are named here, where
 * the bundler can follow them, by the rules the framework itself uses.
 *
 *   bun scripts/desktop-bundle.ts
 *
 * Run it before `buddy build:desktop` or `buddy dev:desktop`. Both outputs are
 * build products and are not committed; the declaration file beside them is,
 * so a type check does not need them.
 *
 * The module is JavaScript with a declaration file, not TypeScript, on
 * purpose. As TypeScript it pulls every framework default it names into the
 * app's type check, and those are written against framework globals the app's
 * program does not declare: the check failed on files this project does not
 * own. The declaration file states what the module exports and nothing about
 * what it imports.
 */
import { Database } from 'bun:sqlite'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import process from 'node:process'

const root = join(import.meta.dir, '..')
const out = join(root, 'app/Desktop/bundle.generated.js')
const types = join(root, 'app/Desktop/bundle.generated.d.ts')
const template = join(root, 'app/Desktop/database.template.sqlite')

interface RouteFile { file: string, prefix?: string, middleware?: string[] }

async function routeFiles(): Promise<RouteFile[]> {
  const manifest = join(root, 'app/Routes.ts')
  const loaded = existsSync(manifest)
    ? (await import(manifest) as { default?: Record<string, string | { path: string, prefix?: string, middleware?: string | string[] }> }).default
    : undefined
  const registry = loaded && Object.keys(loaded).length ? loaded : { api: 'api' }
  const files: RouteFile[] = []

  for (const [key, definition] of Object.entries(registry)) {
    const config = typeof definition === 'string' ? { path: definition } : definition
    const file = ['.ts', '.js'].map(extension => join(root, 'routes', `${config.path}${extension}`)).find(candidate => existsSync(candidate))
    if (!file) continue

    const prefix = config.prefix !== undefined
      ? (config.prefix ? (config.prefix.startsWith('/') ? config.prefix : `/${config.prefix}`) : undefined)
      : (key === 'web' ? undefined : `/${key}`)
    const middleware = config.middleware === undefined ? [] : Array.isArray(config.middleware) ? config.middleware : [config.middleware]
    files.push({ file, ...(prefix ? { prefix } : {}), ...(middleware.length ? { middleware } : {}) })
  }

  return files
}

/**
 * An action named by string in a route file: `'Actions/Postline/QueueListAction'`.
 * Built from a string because the pattern is made of quote characters, and a
 * regex literal full of them is hard to read past.
 */
const QUOTE = '[\'"`]'
const ACTION_NAME = new RegExp(`${QUOTE}(Actions/[\\w/-]+?)(?:\\.ts)?${QUOTE}`, 'g')

function actionFiles(sources: string[]): Record<string, string> {
  const actions: Record<string, string> = {}
  for (const source of sources) {
    for (const match of readFileSync(source, 'utf8').matchAll(ACTION_NAME)) {
      const name = match[1]!
      if (actions[name]) continue
      const file = [join(root, 'app', `${name}.ts`), join(root, 'storage/framework/defaults/app', `${name}.ts`)].find(candidate => existsSync(candidate))
      if (file) actions[name] = file
    }
  }
  return actions
}

/** A path as the generated file imports it: relative, so the file is the same on every machine. */
function spec(file: string): string {
  const path = relative(join(root, 'app/Desktop'), file)
  return JSON.stringify(path.startsWith('.') ? path : `./${path}`)
}

/**
 * Every middleware the app can be asked for, by class name: the framework's
 * defaults, then `app/Middleware/*.ts` over them.
 *
 * All of them, not only the ones the route file names. `csrf` is checked on
 * every write without a route asking for it, and the alias map can point any
 * name at any class.
 */
function middlewareFiles(): Record<string, string> {
  const middleware: Record<string, string> = {}
  for (const dir of [join(root, 'storage/framework/defaults/app/Middleware'), join(root, 'app/Middleware')]) {
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts') || file.endsWith('.d.ts') || file.endsWith('.test.ts')) continue
      middleware[file.slice(0, -3)] = join(dir, file)
    }
  }
  return middleware
}

/**
 * The database a new install starts from: migrated by the framework itself,
 * so it is exactly what `buddy migrate` makes, and empty.
 *
 * Made by running the real command against a scratch file. Deciding here
 * which migrations apply would be a second copy of the framework's rules
 * (it skips the ones belonging to features this app has not installed), and
 * the copy would drift.
 */
function buildDatabaseTemplate(): string[] {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${template}${suffix}`, { force: true })

  const migrated = Bun.spawnSync(['./buddy', 'migrate'], {
    cwd: root,
    env: { ...process.env, DB_CONNECTION: 'sqlite', DB_DATABASE_PATH: template },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (migrated.exitCode !== 0 || !existsSync(template))
    throw new Error(`buddy migrate failed while building the database template:\n${migrated.stderr.toString().slice(-2000)}`)

  // One file, with nothing left in a write-ahead log beside it: the template
  // is copied as a single file, and a `-wal` left behind would be lost.
  const database = new Database(template)
  database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  database.exec('PRAGMA journal_mode = DELETE')
  const applied = (database.query('SELECT migration FROM migrations ORDER BY id').all() as Array<{ migration: string }>).map(row => row.migration)
  database.close()
  for (const suffix of ['-wal', '-shm']) rmSync(`${template}${suffix}`, { force: true })

  return applied
}

/**
 * The workspace's own scripts, bundled for a browser.
 *
 * The layout loads them as `<script type="module" src="/assets/scripts/x.ts">`.
 * The dev server transpiles a `.ts` asset as it serves it; the built app has
 * no such server, and its static files would hand the web view TypeScript
 * with a video MIME type, which it refuses. Each script is bundled here, with
 * whatever it imports from npm, and the agent answers the same URLs with the
 * result.
 */
async function clientScripts(): Promise<Record<string, string>> {
  const dir = join(root, 'resources/assets/scripts')
  const referenced = new Set<string>()
  for (const folder of ['resources/layouts', 'resources/views', 'resources/components']) {
    const glob = new Bun.Glob('**/*.stx')
    for (const file of glob.scanSync({ cwd: join(root, folder), absolute: true })) {
      for (const match of readFileSync(file, 'utf8').matchAll(/src="\/assets\/scripts\/([\w.-]+\.ts)"/g))
        referenced.add(match[1]!)
    }
  }

  const scripts: Record<string, string> = {}
  for (const name of [...referenced].sort()) {
    const built = await Bun.build({ entrypoints: [join(dir, name)], target: 'browser', format: 'esm', minify: true })
    if (!built.success || built.outputs.length !== 1)
      throw new Error(`Could not bundle resources/assets/scripts/${name}:\n${built.logs.map(log => String(log)).join('\n')}`)
    scripts[`/assets/scripts/${name}`] = await built.outputs[0]!.text()
  }

  return scripts
}

const routes = await routeFiles()
const scripts = await clientScripts()
const actions = actionFiles(routes.map(route => route.file))
const names = Object.keys(actions).sort()
const middleware = middlewareFiles()
const middlewareNames = Object.keys(middleware).sort()
const migrations = buildDatabaseTemplate()

const missing = migrations.filter(name => !existsSync(join(root, 'database/migrations', name)))
if (missing.length > 0)
  throw new Error(`The database template applied migrations that are not in database/migrations: ${missing.join(', ')}`)

const source = `// Written by scripts/desktop-bundle.ts. Do not edit: run \`bun scripts/desktop-bundle.ts\`.
//
// Everything the desktop agent carries inside its compiled binary, as static
// imports the bundler can follow. See the script for why.

import databaseTemplate from './database.template.sqlite' with { type: 'file' }
${migrations.map((name, index) => `import migration${index} from ${spec(join(root, 'database/migrations', name))} with { type: 'text' }`).join('\n')}

export { databaseTemplate }

export const routes = [
${routes.map(route => `  { load: () => import(${spec(route.file)})${route.prefix ? `, prefix: ${JSON.stringify(route.prefix)}` : ''}${route.middleware?.length ? `, middleware: ${JSON.stringify(route.middleware)}` : ''} },`).join('\n')}
]

export const actions = {
${names.map(name => `  ${JSON.stringify(name)}: () => import(${spec(actions[name]!)}),`).join('\n')}
}

export const middleware = {
${middlewareNames.map(name => `  ${JSON.stringify(name)}: () => import(${spec(middleware[name]!)}),`).join('\n')}
}

export const migrations = {
${migrations.map((name, index) => `  ${JSON.stringify(name)}: migration${index},`).join('\n')}
}

/** The workspace's client scripts, bundled for the web view, by the URL the pages ask for. */
export const clientScripts = ${JSON.stringify(scripts)}

export async function jobs() {
  const [publishScheduledPosts, syncEngagementMetrics, scanKeywordMonitors, syncDirectMessages, autoDeletePosts] = await Promise.all([
    import('../Jobs/PublishScheduledPosts.ts'),
    import('../Jobs/SyncEngagementMetrics.ts'),
    import('../Jobs/ScanKeywordMonitors.ts'),
    import('../Jobs/SyncDirectMessages.ts'),
    import('../Jobs/AutoDeletePosts.ts'),
  ])

  return {
    publishScheduledPosts: publishScheduledPosts.default,
    syncEngagementMetrics: syncEngagementMetrics.default,
    scanKeywordMonitors: scanKeywordMonitors.default,
    syncDirectMessages: syncDirectMessages.default,
    autoDeletePosts: autoDeletePosts.default,
  }
}
`

writeFileSync(out, source)
writeFileSync(types, `// Written by scripts/desktop-bundle.ts. Do not edit.

type Loader = () => Promise<{ default?: unknown }>

interface Runnable {
  name: string
  handle?: (...args: any[]) => unknown
}

/** The built, migrated, empty database, as a path the process can read. */
export declare const databaseTemplate: string

/** A route file as \`app/Routes.ts\` mounts it. */
export declare const routes: Array<{ load: () => Promise<unknown>, prefix?: string, middleware?: string[] }>

/** Every action the route files name by string, by that name. */
export declare const actions: Record<string, Loader>

/** Every middleware, by class name. */
export declare const middleware: Record<string, Loader>

/** Every migration the database template was made from: file name to SQL. */
export declare const migrations: Record<string, string>

/** The workspace's client scripts as browser JavaScript, by the URL the pages ask for. */
export declare const clientScripts: Record<string, string>

/** The recurring jobs, loaded on demand. */
export declare function jobs(): Promise<{
  publishScheduledPosts: Runnable
  syncEngagementMetrics: Runnable
  scanKeywordMonitors: Runnable
  syncDirectMessages: Runnable
  autoDeletePosts: Runnable
}>
`)

// eslint-disable-next-line no-console
console.log(`Wrote ${relative(root, out)}: ${routes.length} route file(s), ${names.length} action(s), ${middlewareNames.length} middleware, ${migrations.length} migration(s), ${Object.keys(scripts).length} client script(s), and ${relative(root, template)}`)
process.exit(0)
