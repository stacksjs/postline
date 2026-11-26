import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * No environment variable name reaches a person using the app (#174). An
 * error that says "Set BLUESKY_APP_PASSWORD" is written for whoever deployed
 * the server; the person reading it wants to know where to click. Operators
 * find the variables in docs/self-hosting.md.
 *
 * The check reads the string literals on lines that build an error or a
 * message, minus their ${} interpolations (a constant's value is fine, its
 * name in prose is not).
 */
const root = join(import.meta.dir, '../..')
const ENV_NAME = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]{2,}\b/
const MESSAGE_LINE = /throw new \w*Error\(|\berror:|\bmessage:|\breason:|setStatus\(|errorMessage\.set\(|Description = derived/

// The marketing site's privacy pages are written for the people who host it.
const SKIP = new Set(['resources/views/your-data.stx', 'resources/views/privacy.stx'])

function files(): string[] {
  const out: string[] = []
  for (const pattern of ['app/Actions/**/*.ts', 'app/Services/**/*.ts', 'app/Support/Social/**/*.ts', 'resources/views/*.stx', 'resources/components/**/*.stx']) {
    for (const file of new Bun.Glob(pattern).scanSync({ cwd: root })) {
      if (!SKIP.has(file)) out.push(file)
    }
  }
  return out
}

function literals(line: string): string[] {
  return [...line.matchAll(/'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"|`([^`]*)`/g)]
    .map(match => (match[1] ?? match[2] ?? match[3] ?? '').replace(/\$\{[^}]*\}/g, ''))
}

describe('messages people read', () => {
  it('never name an environment variable', () => {
    const offenders: string[] = []
    for (const file of files()) {
      readFileSync(join(root, file), 'utf8').split('\n').forEach((line, index) => {
        if (!MESSAGE_LINE.test(line)) return
        if (literals(line).some(text => ENV_NAME.test(text) && /\s/.test(text)))
          offenders.push(`${file}:${index + 1}  ${line.trim().slice(0, 100)}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
