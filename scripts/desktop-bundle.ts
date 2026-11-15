/**
 * Write `app/Desktop/bundle.generated.js`: the app's routes and actions as
 * static imports, for the desktop agent.
 *
 * The Mac app runs Postline's own API inside itself. Its agent is one compiled
 * binary with no project tree beside it, and the router finds route files and
 * `'Actions/...'` handlers by importing them off disk, which a compiled binary
 * cannot do. So they are named here, where the bundler can follow them, by
 * the rules the router itself uses: route files as `app/Routes.ts` mounts
 * them, and every action those files name by string, the app's own first and
 * the framework's default second.
 *
 *   bun scripts/desktop-bundle.ts
 *
 * `buddy build:desktop` runs it first (see app/Desktop/build-views.ts), so the
 * file is never stale in a build.
 *
 * JavaScript with a declaration file beside it, not TypeScript, on purpose. As
 * TypeScript it pulls every framework default action it names into the app's
 * type check, and those are written against framework globals the app's
 * program does not declare: the check failed on files this project does not
 * own. The declaration file states what the module exports and nothing about
 * what it imports.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import process from 'node:process'

const root = join(import.meta.dir, '..')
const out = join(root, 'app/Desktop/bundle.generated.js')
const types = join(root, 'app/Desktop/bundle.generated.d.ts')

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

const routes = await routeFiles()
const actions = actionFiles(routes.map(route => route.file))
const names = Object.keys(actions).sort()

const source = `// Written by scripts/desktop-bundle.ts. Do not edit: run \`bun scripts/desktop-bundle.ts\`.
//
// The app's routes and actions as static imports, so they travel inside the
// desktop agent's compiled binary. See the script for why.

export const routes = [
${routes.map(route => `  { load: () => import(${spec(route.file)})${route.prefix ? `, prefix: ${JSON.stringify(route.prefix)}` : ''}${route.middleware?.length ? `, middleware: ${JSON.stringify(route.middleware)}` : ''} },`).join('\n')}
]

export const actions = {
${names.map(name => `  ${JSON.stringify(name)}: () => import(${spec(actions[name]!)}),`).join('\n')}
}
`

writeFileSync(out, source)
writeFileSync(types, `// Written by scripts/desktop-bundle.ts. Do not edit.

/** A route file as \`app/Routes.ts\` mounts it. */
export declare const routes: Array<{ load: () => Promise<unknown>, prefix?: string, middleware?: string[] }>

/** Every action the route files name by string, by that name. */
export declare const actions: Record<string, () => Promise<{ default?: unknown }>>
`)
// eslint-disable-next-line no-console
console.log(`Wrote ${relative(root, out)}: ${routes.length} route file(s), ${names.length} action(s)`)
process.exit(0)
