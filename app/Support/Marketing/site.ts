/**
 * Whether this deployment is Postline's public marketing site.
 *
 * The repository holds both the app and the site that describes it. A person
 * running Postline for themselves wants the app at `/`, not a landing page
 * with a waitlist for a hosted plan. So the site is opt-in: only the
 * deployment started with `POSTLINE_SITE=marketing` serves it. Everywhere
 * else, the marketing pages redirect to the workspace and the waitlist
 * endpoint is not mounted.
 *
 * Nothing here imports the framework: `config/server.ts` and `routes/api.ts`
 * both read it, and config loads before almost everything else.
 */
import type { Dirent } from 'node:fs'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

export function isMarketingSite(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.POSTLINE_SITE ?? '').trim().toLowerCase() === 'marketing'
}

/** Where an install sends someone who asks for a marketing page. */
export const WORKSPACE_PATH = '/composer'

/**
 * Every marketing page's path: each view under `resources/views` that extends
 * `layouts/marketing`, so a page added to the site is covered without a list
 * to remember. Exact paths, not `/features/*`: a subtree redirect appends the
 * rest of the path to the target, which would send `/features/analytics` to
 * `/composer/analytics`.
 */
export function marketingPaths(viewsDir: string = join(process.cwd(), 'resources/views')): string[] {
  const paths: string[] = []
  const walk = (dir: string, prefix: string): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    }
    catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), `${prefix}/${entry.name}`)
        continue
      }
      if (!entry.name.endsWith('.stx')) continue
      if (!readFileSync(join(dir, entry.name), 'utf8').includes(`@extends('layouts/marketing')`)) continue
      const name = entry.name.slice(0, -'.stx'.length)
      paths.push(name === 'index' ? (prefix || '/') : `${prefix}/${name}`)
    }
  }
  walk(viewsDir, '')
  return paths.sort()
}

/** The public site redirects retired URLs. Workspace installs redirect marketing pages temporarily. */
export function marketingRedirects(env: Record<string, string | undefined> = process.env, viewsDir?: string): Record<string, { to: string, status: number, preserveQuery: boolean }> {
  const formerCleanupPath = '/features/bulk-delete'
  if (isMarketingSite(env)) return { [formerCleanupPath]: { to: '/features/cleanup', status: 301, preserveQuery: true } }
  const paths = [...marketingPaths(viewsDir), formerCleanupPath]
  return Object.fromEntries(paths.map(path => [path, { to: WORKSPACE_PATH, status: 302, preserveQuery: false }]))
}
