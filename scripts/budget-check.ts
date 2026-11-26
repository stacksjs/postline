/**
 * Hold the built site to its weight budgets (#188).
 *
 *   bun scripts/budget-check.ts [dist]
 *
 * Run after `bun run build:frontend`. For each app page it adds up what the
 * browser must fetch before the page works, gzipped: the page's own inline
 * scripts plus the local scripts it loads, the stylesheets it links or
 * inlines, and the fonts it names. It fails when a page is over budget, or
 * when any page loads a script, stylesheet, font or image from another
 * origin, and prints the offenders. The CI site job runs it.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { gzipSync } from 'node:zlib'

const dist = resolve(import.meta.dir, '..', process.argv[2] || 'dist')
const KB = 1024
export const BUDGETS = { script: 150 * KB, css: 30 * KB, fonts: 60 * KB }

/**
 * Pages over a budget today, held at what they weigh now so they cannot grow.
 * Lower a number when a page gets lighter, and delete it once the page meets
 * the budget; never raise one. The composer and Channels shed weight with the
 * signals rewrites (#162, #172) and the smaller runtime (#186); Settings with
 * the one Settings window (#170).
 */
export const CEILINGS: Record<string, Partial<typeof BUDGETS>> = {
  composer: { script: 156 * KB },
  campaigns: { script: 151 * KB },
  accounts: { script: 153 * KB },
  settings: { css: 32 * KB },
}

/** The workspace pages, which carry the app's scripts. */
const APP_PAGES = ['composer', 'queue', 'timeline', 'analytics', 'campaigns', 'listening', 'inbox', 'accounts', 'activity', 'writing', 'settings', 'login']

const gz = (text: string | Uint8Array): number => gzipSync(typeof text === 'string' ? Buffer.from(text) : text).length
function local(path: string): string | null {
  if (/^(?:https?:)?\/\//.test(path)) return null
  const file = join(dist, path.split(/[?#]/)[0]!)
  return existsSync(file) ? file : null
}

const failures: string[] = []
const rows: string[] = []
for (const page of APP_PAGES) {
  const file = join(dist, `${page}.html`)
  if (!existsSync(file)) {
    failures.push(`${page}: not built`)
    continue
  }
  const html = readFileSync(file, 'utf8')

  let script = 0
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = match[1]!
    if (/type\s*=\s*["'](?!module|text\/javascript)[^"']*["']/i.test(attrs)) continue
    const src = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1]
    if (src) {
      const path = local(src)
      if (path) script += gz(readFileSync(path))
    }
    else {
      script += gz(match[2]!)
    }
  }

  let css = 0
  for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) css += gz(match[1]!)
  for (const match of html.matchAll(/<link\b[^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi)) {
    const href = match[0].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1]
    const path = href ? local(href) : null
    if (path) css += gz(readFileSync(path))
  }

  // The fonts a page waits for: the ones it preloads. Others named in its CSS
  // load only when text set in them is drawn.
  let fonts = 0
  for (const match of html.matchAll(/<link\b(?=[^>]*rel\s*=\s*["']preload["'])(?=[^>]*as\s*=\s*["']font["'])[^>]*>/gi)) {
    const href = match[0].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1]
    const path = href ? local(href) : null
    if (path) fonts += readFileSync(path).length
  }

  // Anything a page fetches from another origin: a script, stylesheet, font
  // or image. Links a person follows are not fetches.
  for (const match of html.matchAll(/<(?:script|img|source|iframe)\b[^>]*\bsrc\s*=\s*["'](https?:)?\/\/([^"'/]+)[^"']*["']|<link\b(?=[^>]*rel\s*=\s*["'](?:stylesheet|preload|modulepreload|icon)["'])[^>]*\bhref\s*=\s*["'](https?:)?\/\/([^"'/]+)/gi)) {
    failures.push(`${page}: loads from another origin (${match[2] || match[4]})`)
  }

  rows.push(`${page.padEnd(10)} script ${(script / KB).toFixed(1).padStart(6)} KB   css ${(css / KB).toFixed(1).padStart(5)} KB   fonts ${(fonts / KB).toFixed(1).padStart(5)} KB`)
  const limit = { ...BUDGETS, ...CEILINGS[page] }
  if (script > limit.script) failures.push(`${page}: scripts ${(script / KB).toFixed(1)} KB gzipped, budget ${limit.script / KB} KB`)
  if (css > limit.css) failures.push(`${page}: CSS ${(css / KB).toFixed(1)} KB gzipped, budget ${limit.css / KB} KB`)
  if (fonts > limit.fonts) failures.push(`${page}: fonts ${(fonts / KB).toFixed(1)} KB, budget ${limit.fonts / KB} KB`)
}

console.log(rows.join('\n'))
if (failures.length) {
  console.error(`\n${failures.length} over budget:\n${failures.map(line => `  ${line}`).join('\n')}`)
  process.exit(1)
}
console.log('\nEvery app page is within its budgets.')
