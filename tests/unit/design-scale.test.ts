/**
 * One radius and shadow scale (#143): a utility class means the same thing
 * everywhere, so nothing redefines one for part of the app.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(import.meta.dir, '../../config/css.ts'), 'utf8')

describe('radius and shadow', () => {
  test('are set in the theme', () => {
    expect(css).toMatch(/borderRadius:\s*\{[^}]*'xl':\s*'10px'[^}]*'2xl':\s*'14px'/)
    expect(css).toMatch(/boxShadow:\s*\{\s*sm:/)
  })

  test('no selector redefines a rounded or shadow utility for part of the app', () => {
    expect(css.match(/\]\s*\.(?:rounded|shadow)-[\w-]+\s*\{/g) ?? []).toEqual([])
  })
})
