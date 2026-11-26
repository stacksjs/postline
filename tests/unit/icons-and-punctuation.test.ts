import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * One icon set and one ellipsis everywhere a person reads (#151). Hugeicons
 * is the set; a second set drawn beside it looks like two apps stitched
 * together. The ellipsis is the single character "…", not three periods.
 */
const resources = join(import.meta.dir, '../../resources')

function templates(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return templates(path)
    return path.endsWith('.stx') ? [path] : []
  })
}

const files = templates(resources).map(path => ({ path: path.slice(resources.length + 1), text: readFileSync(path, 'utf8') }))

describe('one icon set and one ellipsis', () => {
  it('draws every icon from hugeicons or a brand set', () => {
    const offenders = files.filter(file => file.text.includes('i-lucide-')).map(file => file.path)
    expect(offenders).toEqual([])
  })

  it('writes the ellipsis as one character in text people read', () => {
    // A word, three periods, then the end of a string or an element: copy,
    // not a spread operator or a range.
    const offenders = files.flatMap(file =>
      [...file.text.matchAll(/[A-Za-z]\.\.\.(?=['"<`])/g)].map(match => `${file.path}: …${file.text.slice(Math.max(0, match.index - 20), match.index + 4)}`),
    )
    expect(offenders).toEqual([])
  })
})
