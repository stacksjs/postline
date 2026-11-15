import { describe, expect, test } from 'bun:test'
import { APEX, FALLBACK_MAIL_DOMAIN, OWNED, redirectSites, resolveDomains, SUBDOMAIN } from '../../config/domains'

/**
 * The domain model is the one piece of config that four other config files and
 * a deploy read from, and getting it wrong is expensive in a way tests are
 * cheap: a bad `canonical` moves the live site, and a host missing from
 * `redirects` silently stops 301ing and starts serving duplicate content.
 *
 * `resolveDomains` is pure and takes its env values (and the apex) as
 * arguments, so every case below is exercised without touching process.env —
 * including the apex cases, which Postline does not have a domain for yet.
 */

const FUTURE_APEX = 'postline.example'

describe('canonical host', () => {
  test('defaults to the shared-box subdomain', () => {
    expect(resolveDomains({}).canonical).toBe(SUBDOMAIN)
    expect(resolveDomains({}).url).toBe(`https://${SUBDOMAIN}`)
    expect(resolveDomains({}).mode).toBe('subdomain')
  })

  test('the subdomain is the Postline host', () => {
    expect(SUBDOMAIN).toBe('postline.stacksjs.com')
  })

  test('DOMAIN_MODE=domain is ignored while there is no apex', () => {
    const resolved = resolveDomains({ DOMAIN_MODE: 'domain' }, null)

    expect(resolved.canonical).toBe(SUBDOMAIN)
    expect(resolved.mode).toBe('subdomain')
  })

  test('DOMAIN_MODE=domain moves it to the apex once one exists', () => {
    const resolved = resolveDomains({ DOMAIN_MODE: 'domain' }, FUTURE_APEX)

    expect(resolved.canonical).toBe(FUTURE_APEX)
    expect(resolved.mode).toBe('domain')
  })

  test('APP_DOMAIN overrides the mode outright', () => {
    const resolved = resolveDomains({ APP_DOMAIN: 'staging.example.com', DOMAIN_MODE: 'subdomain' })

    expect(resolved.canonical).toBe('staging.example.com')
    expect(resolved.mode).toBe('domain')
  })

  test('an empty or whitespace APP_DOMAIN is not an override', () => {
    // `buddy domain:use subdomain` writes APP_DOMAIN="" to clear a pin. If that
    // counted as an override the canonical host would become the empty string
    // and every redirect would target `https://`.
    expect(resolveDomains({ APP_DOMAIN: '' }).canonical).toBe(SUBDOMAIN)
    expect(resolveDomains({ APP_DOMAIN: '   ' }).canonical).toBe(SUBDOMAIN)
  })

  test('an unrecognised DOMAIN_MODE falls back to the subdomain rather than throwing', () => {
    expect(resolveDomains({ DOMAIN_MODE: 'subdomian' }, FUTURE_APEX).canonical).toBe(SUBDOMAIN)
  })
})

describe('owned hosts', () => {
  test('the declared set matches the apex setting', () => {
    expect(OWNED).toEqual(APEX ? [APEX, SUBDOMAIN] : [SUBDOMAIN])
  })

  test('none of them belongs to the publication product that was split out', () => {
    for (const host of [...OWNED, ...resolveDomains({}).all, FALLBACK_MAIL_DOMAIN])
      expect(host === 'stacksjs.com' || host.endsWith('.stacksjs.com') || host === APEX || host === `www.${APEX}`).toBe(true)
  })
})

describe('redirects', () => {
  test('nothing redirects while the subdomain is the only host', () => {
    expect(resolveDomains({}, null).redirects).toEqual([])
  })

  test('every owned host that is not canonical redirects', () => {
    for (const mode of ['domain', 'subdomain'] as const) {
      const { canonical, redirects } = resolveDomains({ DOMAIN_MODE: mode }, FUTURE_APEX)

      for (const host of [FUTURE_APEX, SUBDOMAIN]) {
        if (host === canonical)
          expect(redirects).not.toContain(host)
        else
          expect(redirects).toContain(host)
      }
    }
  })

  test('links handed out under the old host keep working after a mode switch', () => {
    // The whole point of deriving redirects: whichever host stops being
    // canonical must start redirecting, in both directions.
    expect(resolveDomains({ DOMAIN_MODE: 'domain' }, FUTURE_APEX).redirects).toContain(SUBDOMAIN)
    expect(resolveDomains({ DOMAIN_MODE: 'subdomain' }, FUTURE_APEX).redirects).toContain(FUTURE_APEX)
  })

  test('www is generated for the apex only', () => {
    const { redirects } = resolveDomains({ DOMAIN_MODE: 'domain' }, FUTURE_APEX)

    expect(redirects).toContain(`www.${FUTURE_APEX}`)
    expect(redirects).not.toContain(`www.${SUBDOMAIN}`)
  })

  test('there are no duplicates to fight over a certificate', () => {
    for (const apex of [null, FUTURE_APEX]) {
      for (const mode of ['domain', 'subdomain'] as const) {
        const { all } = resolveDomains({ DOMAIN_MODE: mode }, apex)
        expect(new Set(all).size).toBe(all.length)
      }
    }
  })
})

describe('redirect sites handed to ts-cloud', () => {
  test('one gateway-only site per redirecting host', () => {
    const resolved = resolveDomains({ DOMAIN_MODE: 'domain' }, FUTURE_APEX)
    const sites = redirectSites(resolved)

    expect(Object.keys(sites).length).toBe(resolved.redirects.length)
    expect(Object.keys(sites).length).toBeGreaterThan(0)

    for (const site of Object.values(sites)) {
      expect(resolved.redirects).toContain(site.domain)
      expect(site.redirect.to).toBe(resolved.url)
      expect(site.redirect.status).toBe(301)
      // Without this a deep link from the old host lands on the front page.
      expect(site.redirect.preservePath).toBe(true)
    }
  })

  test('there are none while the subdomain is the only host', () => {
    expect(redirectSites(resolveDomains({}, null))).toEqual({})
  })

  test('site keys are unique and safe to use as systemd/gateway identifiers', () => {
    const sites = redirectSites(resolveDomains({ DOMAIN_MODE: 'domain' }, FUTURE_APEX))
    const keys = Object.keys(sites)

    expect(new Set(keys).size).toBe(keys.length)
    for (const key of keys)
      expect(key).toMatch(/^[a-z0-9-]+$/)
  })

  test('no redirect site collides with the canonical site', () => {
    const resolved = resolveDomains({ DOMAIN_MODE: 'domain' }, FUTURE_APEX)
    for (const site of Object.values(redirectSites(resolved)))
      expect(site.domain).not.toBe(resolved.canonical)
  })
})
