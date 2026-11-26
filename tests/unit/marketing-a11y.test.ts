import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The marketing site's keyboard and motion basics (#232). The browser check
 * covers the workspace; these hold the pieces of the public site that a
 * refactor could drop without any page visibly breaking.
 */
const read = (path: string): string => readFileSync(join(import.meta.dir, '../..', path), 'utf8')

describe('marketing accessibility', () => {
  const layout = read('resources/layouts/marketing.stx')

  it('offers a skip link first, pointing at the main content', () => {
    const skip = layout.indexOf('href="#content"')
    expect(skip).toBeGreaterThan(-1)
    expect(skip).toBeLessThan(layout.indexOf('<SiteHeader />'))
    const main = layout.match(/<main\b[^>]*>/)?.[0]
    expect(main).toContain('id="content"')
    expect(main).toContain('tabindex="-1"')
  })

  it('loads the script that closes the header menus', () => {
    expect(layout).toContain('/assets/scripts/site-menus.ts')
    const script = read('resources/assets/scripts/site-menus.ts')
    expect(script).toContain('\'Escape\'')
    expect(script).toContain('stx:load')
    expect(read('resources/components/Marketing/SiteHeader.stx').match(/name="site-menu"/g)?.length).toBe(2)
  })

  it('gives the moving list of networks a pause control', () => {
    expect(read('resources/views/index.stx')).toContain('marquee-toggle')
    const css = read('resources/assets/styles/marketing.css')
    expect(css).toContain('.marquee:has(.marquee-toggle input:checked) .marquee-track { animation-play-state: paused; }')
  })
})
