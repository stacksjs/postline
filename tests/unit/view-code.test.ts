import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
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

  it('declares each view stylesheet in its own view, not in the layout', () => {
    expect(layout).not.toContain('timeline.css')
    expect(layout).not.toContain('campaigns.css')
    for (const view of ['timeline', 'campaigns']) {
      const source = read(`resources/views/${view}.stx`)
      const styles = source.slice(source.indexOf('@section(\'styles\')'), source.indexOf('@endsection'))
      expect(styles).toContain(`/assets/styles/${view}.css`)
    }
  })

  it('bundles the modules view-code.ts imports by URL, though no page names them', () => {
    const referenced = referencedClientScripts(root)
    expect(referenced).not.toContain('richtext-editor.ts')
    expect(lazyClientScripts(root, referenced)).toEqual(['analytics-chart.ts', 'richtext-editor.ts'])
  })
})
