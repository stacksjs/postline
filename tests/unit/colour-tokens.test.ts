import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * App views name colours by role (`text-success`, `bg-raised`), never by
 * palette (`text-emerald-700`, `bg-white`). A role has a light and a dark
 * value in `config/css.ts`; a palette colour has one, which is how dark mode
 * came to need an `!important` override layer and still had unreadable text.
 *
 * The marketing site is light-only and keeps its own colours.
 */
const root = resolve(import.meta.dir, '../..')
const files = [
  ...readdirSync(join(root, 'resources/views')).filter(name => name.endsWith('.stx') && name !== 'index.stx').map(name => `resources/views/${name}`),
  ...readdirSync(join(root, 'resources/assets/scripts'), { recursive: true, encoding: 'utf8' }).filter(name => name.endsWith('.ts')).map(name => `resources/assets/scripts/${name}`),
  ...readdirSync(join(root, 'resources/functions'), { recursive: true, encoding: 'utf8' }).filter(name => name.endsWith('.ts')).map(name => `resources/functions/${name}`),
  'resources/components/AppSidebar.stx',
  'resources/components/WorkspaceShell.stx',
  'resources/layouts/app.stx',
  'resources/layouts/settings.stx',
]

const PALETTE = /(?<![\w/-])(?:[a-z-]+:)*(?:text|bg|border|ring|divide|outline|placeholder|fill|stroke)-(?:white|black|\[#[\da-fA-F]{3,8}\]|(?:zinc|gray|slate|neutral|stone|red|amber|emerald|blue|violet|green|yellow|orange|sky|indigo|rose|pink|purple|teal|cyan|lime|fuchsia)-\d{2,3})(?:\/\d+)?(?![\w/-])/g

describe('colour tokens', () => {
  for (const file of files) {
    test(`${file} uses no palette colour`, () => {
      expect(readFileSync(join(root, file), 'utf8').match(PALETTE) ?? []).toEqual([])
    })
  }

  test('every token has a light and a dark value', () => {
    const config = readFileSync(join(root, 'config/css.ts'), 'utf8')
    const block = (name: string): string[] => {
      const body = config.slice(config.indexOf(`const ${name}: string = \``)).split('`')[1]!
      return [...body.matchAll(/--([\w-]+):/g)].map(match => match[1]!).sort()
    }
    expect(block('APP_DARK')).toEqual(block('APP_LIGHT'))

    const used = [...config.matchAll(/'([\w-]+)': 'var\(--([\w-]+)\)'/g)].map(match => match[2]!)
    const defined = new Set(block('APP_LIGHT'))
    expect(used.filter(name => !defined.has(name))).toEqual([])
  })
})
