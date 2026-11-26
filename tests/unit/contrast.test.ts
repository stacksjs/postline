/**
 * Contrast on the colour tokens (#142), in both themes: text at 4.5:1 against
 * every surface it sits on, and input borders and the focus ring at 3:1.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(import.meta.dir, '../../config/css.ts'), 'utf8')

function tokens(name: string): Record<string, string> {
  const body = css.slice(css.indexOf(`const ${name}: string = \``)).split('`')[1]!
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(match => [match[1]!, match[2]!.trim()]))
}

function luminance(hex: string): number {
  const channel = (value: number): number => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  const [r, g, b] = [1, 3, 5].map(index => channel(Number.parseInt(hex.slice(index, index + 2), 16) / 255))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

const SURFACES = ['bg', 'panel', 'panel-2', 'panel-3', 'raised']
const TEXT: Array<[string, string]> = [
  ...['ink', 'body', 'muted'].flatMap(fg => SURFACES.map(bg => [fg, bg] as [string, string])),
  ...['success', 'warning', 'danger', 'info', 'note'].flatMap(tone => [[tone, `${tone}-soft`], [tone, 'panel']] as Array<[string, string]>),
  ['on-accent', 'accent'],
]
const NON_TEXT: Array<[string, string]> = ['field-line', 'focus-ring'].flatMap(fg => ['bg', 'panel', 'panel-2'].map(bg => [fg, bg] as [string, string]))

for (const theme of ['APP_LIGHT', 'APP_DARK']) {
  describe(`contrast, ${theme === 'APP_LIGHT' ? 'light' : 'dark'}`, () => {
    const palette = tokens(theme)

    test('text is at least 4.5:1 on every surface', () => {
      const low = TEXT.filter(([fg, bg]) => contrast(palette[fg]!, palette[bg]!) < 4.5).map(([fg, bg]) => `${fg} on ${bg}: ${contrast(palette[fg]!, palette[bg]!).toFixed(2)}`)
      expect(low).toEqual([])
    })

    test('input borders and the focus ring are at least 3:1', () => {
      const low = NON_TEXT.filter(([fg, bg]) => contrast(palette[fg]!, palette[bg]!) < 3).map(([fg, bg]) => `${fg} on ${bg}: ${contrast(palette[fg]!, palette[bg]!).toFixed(2)}`)
      expect(low).toEqual([])
    })
  })
}
