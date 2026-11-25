/**
 * No action sends raw exception text to the browser (#87).
 *
 * An exception's message is written for whoever threw it: a SQLite error, a
 * network client's stack, a path on the server. Actions answer through
 * `actionFailure` / `publicMessage` (app/Support/Http/action-error.ts), which
 * pass a message on only when it was written for the owner.
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '../..')

function files(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name)
    return statSync(join(root, path)).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : []
  })
}

/** Raw exception text: `.message`, String(error), or an error in a template string. */
const RAW = /\b(?:error|err|e)\.message\b|String\((?:error|err|e)\)|\$\{(?:error|err|e)\}/

/** The two error types written for people, which may be shown as they are. */
const FOR_PEOPLE = /instanceof (?:UnsafeUrlError|UserFacingError)/

describe('action errors', () => {
  test('no action puts raw exception text in a response', () => {
    const offenders: string[] = []
    for (const file of files('app/Actions')) {
      readFileSync(join(root, file), 'utf8').split('\n').forEach((line, index) => {
        if (RAW.test(line) && !FOR_PEOPLE.test(line) && !line.trim().startsWith('//') && !/\blog\.|console\./.test(line))
          offenders.push(`${file}:${index + 1}: ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })

  test('the rule catches what it is for', () => {
    expect(RAW.test(`return response.json({ error: error.message })`)).toBe(true)
    expect(RAW.test('throw new Error(`failed: ${err}`)')).toBe(true)
    expect(RAW.test(`return response.json({ error: publicMessage(error) })`)).toBe(false)
  })
})
