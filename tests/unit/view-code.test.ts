import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { lazyClientScripts, referencedClientScripts } from '../../scripts/lib/client-scripts'

/**
 * Code and styles one view needs load with that view (#180). The layout is on
 * every workspace page, so whatever it names, Queue downloads too.
 */
const root = join(import.meta.dir, '../..')
const read = (path: string): string => readFileSync(join(root, path), 'utf8')

describe('code loads only where it is used', () => {
  const layout = read('resources/layouts/app.stx')

  it('keeps the editor and the chart out of the layout', () => {
    const scripts = [...layout.matchAll(/src="\/assets\/scripts\/([\w.-]+)"/g)].map(match => match[1])
    expect(scripts).toContain('view-code.ts')
    expect(scripts.filter(name => /richtext|analytics/.test(name!))).toEqual([])
  })

  it('uses generated CSS for workspace views', () => {
    expect(readdirSync(join(root, 'resources/assets/styles'))).toEqual(['marketing.css'])
  })

  it('bundles optional Composer features for on-demand loading', () => {
    const scripts = referencedClientScripts(root)
    for (const filename of ['composer-previews.ts', 'composer-languages.ts']) {
      expect(scripts).toContain(filename)
      expect(layout).not.toContain(filename)
    }
  })

  it('bundles the editor imported by URL, though no page names it', () => {
    const referenced = referencedClientScripts(root)
    expect(referenced).not.toContain('richtext-editor.ts')
    expect(lazyClientScripts(root, referenced)).toEqual(['browser-share.ts', 'richtext-editor.ts'])
  })
})
