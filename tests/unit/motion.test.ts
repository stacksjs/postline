import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Motion (#152): durations from three tokens, and one reduced-motion guard
 * that leaves nothing moving but opacity.
 */
const root = join(import.meta.dir, '../..')
const read = (path: string): string => readFileSync(join(root, path), 'utf8')
const css = read('config/css.ts')

describe('motion', () => {
  it('defines the three durations once', () => {
    for (const token of ['--duration-fast: 120ms', '--duration: 150ms', '--duration-slow: 180ms'])
      expect(css).toContain(token)
  })

  it('has one guard that keeps only opacity moving', () => {
    const guard = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n  *, *::before, *::after {'))
    expect(guard).toContain('animation-duration: 0.01ms !important')
    expect(guard).toContain('transition-property: opacity !important')
    expect(guard).toContain('::view-transition-group(*)')
  })

  it('keeps app durations between 120 and 180 ms', () => {
    const templates = [...new Bun.Glob('resources/{views,components,layouts}/**/*.stx').scanSync({ cwd: root })]
    const slow = templates.flatMap(file => [...read(file).matchAll(/\bduration-(\d+)\b/g)]
      .filter(match => Number(match[1]) > 180 || Number(match[1]) < 120)
      .map(match => `${file}: ${match[0]}`))
    expect(slow).toEqual([])
    expect(read('resources/assets/styles/toast.css')).not.toMatch(/\b(2\d\d|[3-9]\d\d)ms\b/)
  })
})
