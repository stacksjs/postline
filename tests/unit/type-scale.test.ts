import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * The app's type is one scale (12, 13, 14, 16, 20, 24) and three weights
 * (400, 500, 600), set in `config/css.ts`. A bracketed pixel size or a bold
 * weight in a view is how the scale eroded to nine extra sizes last time, so
 * a view that brings one back fails here.
 *
 * The marketing site has its own, larger scale and is not checked.
 */
const root = resolve(import.meta.dir, '../..')
const appViews = [
  ...readdirSync(join(root, 'resources/views')).filter(name => name.endsWith('.stx') && name !== 'index.stx').map(name => `resources/views/${name}`),
  'resources/components/AppSidebar.stx',
  'resources/layouts/app.stx',
  'resources/layouts/settings.stx',
]

describe('the type scale', () => {
  for (const file of appViews) {
    const source = readFileSync(join(root, file), 'utf8')

    test(`${file} uses no bracketed text size`, () => {
      expect(source.match(/\btext-\[\d+(?:\.\d+)?(?:px|rem|em)\]/g) ?? []).toEqual([])
    })

    test(`${file} sets nothing in bold`, () => {
      expect(source.match(/(?<![\w-])font-(?:bold|extrabold|black)(?![\w-])/g) ?? []).toEqual([])
    })
  }
})
