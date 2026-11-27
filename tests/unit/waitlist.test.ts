import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '../..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('waitlist', () => {
  test('the form sends the honeypot and never says whether an address was already there', () => {
    const form = read('resources/components/Marketing/Waitlist.stx')
    expect(form).toContain('name="website"')
    expect(form).toContain('action="/api/email/subscribe" method="post"')
    const script = read('resources/assets/scripts/lib/site-waitlist.ts')
    expect(script).toContain('new FormData(form)')
    expect(script).toContain("accept: 'application/json'")
    expect(form + script).not.toMatch(/already subscribed|already on the list/i)
  })

  test('Postline has its own confirm and welcome emails, with no framework copy in them', () => {
    const emails = readdirSync(join(root, 'resources/emails')).filter(name => name.endsWith('.stx'))
    expect(emails).toContain('subscription-confirm.stx')
    expect(emails).toContain('subscription-confirmation.stx')
    for (const name of emails) {
      const body = read(`resources/emails/${name}`)
      expect(body, name).not.toMatch(/stacksjs|discord\.gg|application development framework/i)
      expect(body, name).toContain('MAIL_POSTAL_ADDRESS')
    }
  })

  test('the generated template registry points at Postline\'s emails', () => {
    const registry = read('storage/framework/auto-imports/emails.ts')
    expect(registry).toContain(`'subscription-confirm': '../../../resources/emails/subscription-confirm.stx'`)
    expect(registry).toContain(`'subscription-confirmation': '../../../resources/emails/subscription-confirmation.stx'`)
  })
})
