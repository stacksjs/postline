/**
 * The desktop agent: Postline's own API, served inside the Mac app.
 *
 * The framework's launcher starts this module, opens a loopback port only the
 * app's own window can call, and serves the built workspace pages. This file
 * adds what makes it Postline: the database and the app key in Application
 * Support, the routes and actions under `/api`, and the recurring jobs.
 *
 * Nothing from the framework or the app is imported at the top. See
 * app/Desktop/data.ts for why the order matters: the data directory has to be
 * the working directory, and the database path and app key have to be in the
 * environment, before any of those modules are first evaluated.
 */
import type { WebviewAgentModule } from '@stacksjs/desktop-build'
import type { Schedule } from './schedule'
import { prepareData } from './data'

type Handler = (request: Request) => Response | Promise<Response>

let handler: Handler | null = null
let clientScripts: Record<string, string> = {}
let schedule: Schedule | null = null

async function boot(dataDir: string, origin: string): Promise<void> {
  // The routes, actions, middleware, migrations and the built database, as
  // static imports the bundler can follow. Written by scripts/desktop-bundle.ts.
  const bundle = await import('./bundle.generated.js')

  // Postline's config/, compiled in, before anything loads config: the loader
  // reads it once, and from disk it would find nothing here and fall back to
  // the framework's defaults without a word (#196).
  const { describeConfigSource, registerBundledConfig, settledConfigSource } = await import('@stacksjs/config/sources')
  registerBundledConfig(bundle.config)

  clientScripts = bundle.clientScripts

  const prepared = prepareData({ dataDir, template: bundle.databaseTemplate, migrations: bundle.migrations, origin })
  if (prepared.created) console.log(`[postline] created ${prepared.databasePath}`)
  for (const name of prepared.applied) console.log(`[postline] migrated: ${name}`)

  // Load it now and say which config this process runs on.
  await (await import('@stacksjs/config')).overridesReady
  const source = await settledConfigSource()
  if (source) {
    console.log(`[postline] ${describeConfigSource(source)}`)
    if (source.failed.length) throw new Error(`config failed to load: ${source.failed.map(file => `config/${file.name}.ts: ${file.error}`).join('; ')}`)
  }

  const { stacksAgentHandler } = await import('@stacksjs/desktop-build')
  handler = await stacksAgentHandler({
    appRoutes: false,
    routes: bundle.routes,
    actions: bundle.actions,
    middleware: bundle.middleware,
  })

  const { startSchedule } = await import('./schedule')
  const jobs = await bundle.jobs()
  const { readHeartbeats } = await import('../Support/heartbeat')
  schedule = startSchedule(jobs, {
    say: line => console.error(line),
    // When each job last started, so overdue ones run at launch (#197).
    lastRuns: async () => Object.fromEntries((await readHeartbeats()).map(beat => [beat.job, beat.lastStartedAt])),
  })
}

export default {
  async start(context) {
    await boot(context.dataDir, context.origin)
  },

  async fetch(request) {
    const { pathname } = new URL(request.url)

    // The workspace's own scripts. The pages ask for them by their `.ts` name;
    // the build bundled each one for a browser. Left to the static views they
    // would arrive as TypeScript, which a web view will not run.
    const script = clientScripts[pathname]
    if (script !== undefined) {
      return new Response(script, {
        headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' },
      })
    }

    // The app has one front door. `/` is the marketing site's landing page and
    // `/login` is for a server with accounts; inside the app both mean the
    // workspace.
    if (pathname === '/' || pathname === '/login')
      return Response.redirect(new URL('/composer', request.url).toString(), 302)

    // Everything else that is not the API is a page, and the built views answer those.
    if (!pathname.startsWith('/api/')) return

    if (!handler)
      return Response.json({ ok: false, error: 'Postline is still starting.' }, { status: 503 })

    return handler(request)
  },

  stop() {
    schedule?.stop()
  },
} satisfies WebviewAgentModule
