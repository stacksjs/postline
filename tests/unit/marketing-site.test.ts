import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isMarketingSite, marketingPaths, marketingRedirects, WORKSPACE_PATH } from '../../app/Support/Marketing/site'

const root = join(import.meta.dir, '../..')

describe('the marketing site is served only where asked for (#222)', () => {
  test('only POSTLINE_SITE=marketing turns it on', () => {
    expect(isMarketingSite({})).toBe(false)
    expect(isMarketingSite({ POSTLINE_SITE: '' })).toBe(false)
    expect(isMarketingSite({ POSTLINE_SITE: 'app' })).toBe(false)
    expect(isMarketingSite({ POSTLINE_SITE: 'marketing' })).toBe(true)
    expect(isMarketingSite({ POSTLINE_SITE: ' Marketing ' })).toBe(true)
  })

  test('every page on the marketing layout is found, and nothing else', () => {
    const paths = marketingPaths(join(root, 'resources/views'))
    for (const path of ['/', '/features', '/features/analytics', '/use-cases', '/use-cases/agencies', '/privacy', '/your-data', '/trademarks'])
      expect(paths).toContain(path)
    for (const app of ['/composer', '/queue', '/settings', '/login', '/writing'])
      expect(paths).not.toContain(app)
  })

  test('an install sends each one to the workspace with a temporary redirect', () => {
    const redirects = marketingRedirects({}, join(root, 'resources/views'))
    expect(Object.keys(redirects)).toEqual(marketingPaths(join(root, 'resources/views')))
    for (const rule of Object.values(redirects))
      expect(rule).toEqual({ to: WORKSPACE_PATH, status: 302, preserveQuery: false })
  })

  test('the marketing site redirects nothing', () => {
    expect(marketingRedirects({ POSTLINE_SITE: 'marketing' }, join(root, 'resources/views'))).toEqual({})
  })

  test('the server config and the waitlist route both ask', () => {
    expect(readFileSync(join(root, 'config/server.ts'), 'utf8')).toContain('redirects: marketingRedirects()')
    expect(readFileSync(join(root, 'routes/api.ts'), 'utf8')).toMatch(/if \(isMarketingSite\(\)\)\s*\n\s*route\.post\('\/subscribe'/)
  })
})
