/**
 * Every environment variable the app reads is documented in .env.example (#212).
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '../..')

/** Set by the build, the tests or the Mac app, never by someone installing Postline. */
const INTERNAL = new Set([
  'NODE_ENV',
  'DOTENV_PRIVATE_KEY', // the framework's encrypted-env key, held outside .env
  'DESKTOP_VIEWS_OUT', // set by buddy build:desktop
  'POSTLINE_DESKTOP_AGENT', // set by the Mac app's agent process
  'POSTLINE_BLOG_DIR', // the test suite's blog folder
  'POSTLINE_MEDIA_TUNNEL', // set inside the process that opens a temporary image link
])

function files(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(join(root, path)).isDirectory()) return files(path)
    return /\.(?:ts|stx)$/.test(name) ? [path] : []
  })
}

function readKeys(): Set<string> {
  const keys = new Set<string>()
  for (const dir of ['app', 'config', 'routes', 'resources/views', 'resources/emails']) {
    for (const file of files(dir)) {
      for (const match of readFileSync(join(root, file), 'utf8').matchAll(/(?:process\.env|Bun\.env|\benv)\.([A-Z][A-Z0-9_]+)/g))
        keys.add(match[1]!)
    }
  }
  return keys
}

describe('the environment reference', () => {
  test('every key the app reads is in .env.example, set or commented', () => {
    const example = readFileSync(join(root, '.env.example'), 'utf8')
    const documented = new Set([...example.matchAll(/^#?\s?([A-Z][A-Z0-9_]+)=/gm)].map(match => match[1]!))
    const missing = [...readKeys()].filter(key => !documented.has(key) && !INTERNAL.has(key)).sort()
    expect(missing).toEqual([])
  })

  test('the example names no product Postline is not', () => {
    const example = readFileSync(join(root, '.env.example'), 'utf8')
    for (const leftover of ['STRIPE_', 'MEILISEARCH_', 'FRONTEND_', 'FILESYSTEM_', 'stacks:queue'])
      expect(example, leftover).not.toContain(leftover)
  })
})
