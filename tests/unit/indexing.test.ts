import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * The workspace is private. Every workspace page, including sign-in and
 * setup, says noindex, which also keeps it out of the sitemap: the stx build
 * leaves noindex pages out. The marketing pages say nothing of the sort.
 */
const root = resolve(import.meta.dir, '../..')
const read = (path: string): string => readFileSync(join(root, path), 'utf8')
const entryViews = ['login.stx', 'setup.stx']

describe('what search engines may index', () => {
  test('the workspace layouts and entry pages are noindex', () => {
    expect(read('resources/layouts/app.stx')).toContain('<meta name="robots" content="noindex, nofollow">')
    expect(read('resources/layouts/settings.stx')).toContain('<meta name="robots" content="noindex, nofollow">')
    for (const view of entryViews)
      expect(read(`resources/views/${view}`)).toContain("@meta('robots', 'noindex, nofollow')")
  })

  test('every app view uses a noindex layout', () => {
    const publicViews = ['index.stx', 'privacy.stx', 'your-data.stx', 'trademarks.stx', 'changelog.stx', 'roadmap.stx', 'download.stx', 'blog.stx', '404.stx']
    const views = readdirSync(join(root, 'resources/views')).filter(name => name.endsWith('.stx') && !publicViews.includes(name) && !entryViews.includes(name))
    for (const view of views)
      expect(read(`resources/views/${view}`)).toMatch(/@extends\('layouts\/(app|settings)'\)/)
  })

  test('the marketing layout stays indexable', () => {
    expect(read('resources/layouts/marketing.stx')).not.toContain('noindex')
  })

  test('the public Blog is indexable', () => {
    expect(read('resources/layouts/blog.stx')).not.toContain('noindex')
  })

  test('no view sets a description the app layout never shows', () => {
    const views = readdirSync(join(root, 'resources/views')).filter(name => name.endsWith('.stx'))
    for (const view of views) {
      const source = read(`resources/views/${view}`)
      if (/@extends\('layouts\/(app|settings)'\)/.test(source))
        expect(source).not.toContain("@section('description'")
    }
  })
})
