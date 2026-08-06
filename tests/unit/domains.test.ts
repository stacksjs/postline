import { describe, expect, test } from 'bun:test'
import { APEX, LEGACY_HOSTS, OWNED, redirectSites, resolveDomains, SHORT_DOMAINS, SUBDOMAIN } from '../../config/domains'

/**
 * The domain model is the one piece of config that four other config files and
 * a deploy read from, and getting it wrong is expensive in a way tests are
 * cheap: a bad `canonical` moves the live site, and a host missing from
 * `redirects` silently stops 301ing and starts serving duplicate content —
 * which is exactly what happened to postline.stacksjs.com after the rename.
 *
 * `resolveDomains` is pure and takes its two env values as arguments, so every
 * case below is exercised without touching process.env.
 */

describe('canonical host', () => {
  test('defaults to the apex', () => {
    expect(resolveDomains({}).canonical).toBe(APEX)
    expect(resolveDomains({}).url).toBe(`https://${APEX}`)
  })

  test('DOMAIN_MODE=subdomain moves it to the shared box', () => {
    expect(resolveDomains({ DOMAIN_MODE: 'subdomain' }).canonical).toBe(SUBDOMAIN)
  })

  test('APP_DOMAIN overrides the mode outright', () => {
    const resolved = resolveDomains({ APP_DOMAIN: 'staging.theot.org', DOMAIN_MODE: 'subdomain' })

    expect(resolved.canonical).toBe('staging.theot.org')
    expect(resolved.mode).toBe('domain')
  })

  test('an empty or whitespace APP_DOMAIN is not an override', () => {
    // `buddy domain:use domain` writes APP_DOMAIN="" to clear a pin. If that
    // counted as an override the canonical host would become the empty string
    // and every redirect would target `https://`.
    expect(resolveDomains({ APP_DOMAIN: '' }).canonical).toBe(APEX)
    expect(resolveDomains({ APP_DOMAIN: '   ' }).canonical).toBe(APEX)
  })

  test('an unrecognised DOMAIN_MODE falls back to the apex rather than throwing', () => {
    expect(resolveDomains({ DOMAIN_MODE: 'subdomian' }).canonical).toBe(APEX)
  })
})

describe('redirects', () => {
  test('every owned host that is not canonical redirects', () => {
    for (const mode of ['domain', 'subdomain'] as const) {
      const { canonical, redirects } = resolveDomains({ DOMAIN_MODE: mode })

      for (const host of OWNED) {
        if (host === canonical)
          expect(redirects).not.toContain(host)
        else
          expect(redirects).toContain(host)
      }
    }
  })

  test('the canonical host never redirects to itself', () => {
    for (const mode of ['domain', 'subdomain'] as const) {
      const { canonical, redirects } = resolveDomains({ DOMAIN_MODE: mode })
      expect(redirects).not.toContain(canonical)
    }
  })

  test('links handed out under the old host keep working after a mode switch', () => {
    // The whole point of deriving redirects: whichever host stops being
    // canonical must start redirecting, in both directions.
    expect(resolveDomains({ DOMAIN_MODE: 'domain' }).redirects).toContain(SUBDOMAIN)
    expect(resolveDomains({ DOMAIN_MODE: 'subdomain' }).redirects).toContain(APEX)
  })

  test('the previous identity still resolves somewhere', () => {
    const { redirects } = resolveDomains({})
    for (const host of LEGACY_HOSTS)
      expect(redirects).toContain(host)
  })

  test('www is generated for the apex only', () => {
    const { redirects } = resolveDomains({})

    expect(redirects).toContain(`www.${APEX}`)
    for (const short of SHORT_DOMAINS)
      expect(redirects).not.toContain(`www.${short}`)
  })

  test('there are no duplicates to fight over a certificate', () => {
    const { all } = resolveDomains({})
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('cross-provider coverage', () => {
  /**
   * The redirect set deliberately spans two DNS accounts: the apex and the
   * short domains are Porkbun zones, the shared-box hosts live in a Route53
   * zone owned by a different cloud account. `buddy deploy` resolves a provider
   * per domain, so both are published in one run — this asserts the config
   * still asks for both, because a redirect set that collapsed to one provider
   * would pass every other test here while quietly dropping the migration path.
   */
  const inZone = (host: string, zone: string) => host === zone || host.endsWith(`.${zone}`)

  test('spans both the Porkbun zones and the Route53 zone', () => {
    const { all } = resolveDomains({})

    expect(all.some(host => inZone(host, APEX))).toBe(true)
    expect(all.some(host => SHORT_DOMAINS.some(short => inZone(host, short)))).toBe(true)
    expect(all.some(host => inZone(host, 'stacksjs.com'))).toBe(true)
  })
})

describe('redirect sites handed to ts-cloud', () => {
  test('one gateway-only site per redirecting host', () => {
    const resolved = resolveDomains({})
    const sites = redirectSites(resolved)

    expect(Object.keys(sites).length).toBe(resolved.redirects.length)

    for (const site of Object.values(sites)) {
      expect(resolved.redirects).toContain(site.domain)
      expect(site.redirect.to).toBe(resolved.url)
      expect(site.redirect.status).toBe(301)
      // Without this a reader following a deep link from the old host lands on
      // the front page instead of the story they were sent.
      expect(site.redirect.preservePath).toBe(true)
    }
  })

  test('site keys are unique and safe to use as systemd/gateway identifiers', () => {
    const sites = redirectSites(resolveDomains({}))
    const keys = Object.keys(sites)

    expect(new Set(keys).size).toBe(keys.length)
    for (const key of keys)
      expect(key).toMatch(/^[a-z0-9-]+$/)
  })

  test('no redirect site collides with the canonical site', () => {
    const resolved = resolveDomains({})
    for (const site of Object.values(redirectSites(resolved)))
      expect(site.domain).not.toBe(resolved.canonical)
  })
})
