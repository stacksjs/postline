/**
 * Hold the built site to its weight budgets (#188).
 *
 *   bun scripts/budget-check.ts [dist]
 *
 * Run after `bun run build:frontend`. It measures the gzip size of the
 * page's inline scripts, including inert island setup, and its initial
 * local script assets. It also counts linked and inline stylesheets and
 * preloaded fonts. The CI site job uses it to enforce budgets and flag
 * scripts, stylesheets, fonts, and images loaded from another origin.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { gzipSync } from 'node:zlib'

const dist = resolve(import.meta.dir, '..', process.argv[2] || 'dist')
const KB = 1024
export const BUDGETS = { script: 150 * KB, css: 30 * KB, fonts: 60 * KB }
const SCRIPT_TYPES = new Set(['module', 'text/javascript', 'application/javascript', 'stx/island'])

/** The workspace pages, which carry the app's scripts. */
const APP_PAGES = ['composer', 'queue', 'timeline', 'analytics', 'campaigns', 'listening', 'inbox', 'accounts', 'activity', 'writing', 'settings', 'login', 'setup']

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
  const inlineScripts: string[] = []
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = match[1]!
    const type = attrs.match(/(?:^|\s)type\s*=\s*["']([^"']*)["']/i)?.[1]?.trim().toLowerCase()
    if (type && !SCRIPT_TYPES.has(type)) continue
    const src = attrs.match(/(?:^|\s)src\s*=\s*["']([^"']+)["']/i)?.[1]
    if (src) {
      const path = local(src)
      if (path) script += gz(readFileSync(path))
    }
    else if (match[2]!.trim()) inlineScripts.push(match[2]!)
  }
  // Inline blocks share the HTML response's compression dictionary. Linked
  // assets are separate responses, each with a dictionary of its own.
  if (inlineScripts.length) script += gz(inlineScripts.join('\n'))

  const inlineStyles = Array.from(html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi), match => match[1])
  let css = inlineStyles.length ? gz(inlineStyles.join('\n')) : 0
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
  const limit = BUDGETS
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
