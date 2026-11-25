import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '../..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('privacy, data and trademark pages', () => {
  const pages = { '/privacy': 'privacy.stx', '/your-data': 'your-data.stx', '/trademarks': 'trademarks.stx' }

  test('each page exists and the footer links to it', () => {
    const footer = read('resources/components/Marketing/SiteFooter.stx')
    for (const [href, file] of Object.entries(pages)) {
      expect(existsSync(join(root, 'resources/views', file)), file).toBe(true)
      expect(footer).toContain(`href="${href}"`)
    }
  })

  test('the waitlist links to the privacy page', () => {
    expect(read('resources/components/Marketing/Waitlist.stx')).toContain('href="/privacy"')
  })

  test('the privacy contact is its own setting, never the no-reply sender', () => {
    const privacy = read('resources/views/privacy.stx')
    expect(privacy).toContain('PRIVACY_CONTACT_EMAIL')
    expect(privacy).not.toContain('MAIL_FROM_ADDRESS')
  })

  test('the site loads no analytics', () => {
    const analytics = read('config/analytics.ts')
    expect(analytics).not.toMatch(/enabled:\s*true/)
  })
})
