import { env } from '@stacksjs/env'

/**
 * **Domains**
 *
 * The single source of truth for every hostname The Open Times answers on.
 *
 * `config/app.ts`, `config/dns.ts` and `config/cloud.ts` all need to agree on
 * which host is canonical and which ones merely redirect to it. When each of
 * them spelled a domain out itself they drifted: the SSL block still listed
 * `stacksjs.com`, `dns.ts` had published an `A` record for a hostname this app
 * does not own, and `cloud.ts` hardcoded the subdomain as its fallback. Every
 * one of those now reads from here.
 *
 * TWO MODES, ONE CANONICAL HOST
 *
 * The app can live at a subdomain of the shared Stacks box
 * (`opentimes.stacksjs.com`) or at its own apex (`theopentimes.org`). Exactly
 * one of them is canonical at a time, and *every other owned host redirects to
 * whichever one that is* — including the subdomain once the apex takes over, so
 * links handed out before the move keep working instead of 404ing.
 *
 * Flip between them with `buddy domain:use`, which writes `DOMAIN_MODE` into
 * the target env file. Nothing else needs editing.
 */

export type DomainMode = 'subdomain' | 'domain'

/**
 * The masthead domain. This is the one readers see and the one canonical URLs,
 * OG tags and outgoing mail are built from.
 */
export const APEX = 'theopentimes.org'

/**
 * The short forms, all registered at Porkbun alongside the apex. They exist to
 * be typed and shared, not to serve content — each one 301s to the canonical
 * host with its path preserved.
 */
export const SHORT_DOMAINS: readonly string[] = ['theot.org', 'theot.app', 'theot.blog']

/**
 * The tenant hostname on the shared `stacks` Hetzner box. This is where the app
 * ran before it had domains of its own; it stays owned (and stays redirecting)
 * after the move.
 */
export const SUBDOMAIN = 'opentimes.stacksjs.com'

/**
 * The development host. `buddy setup:ssl` issues a certificate for it and adds
 * it to /etc/hosts, and it is the origin every OAuth redirect URL in
 * `.env.example` is written against.
 */
export const LOCAL_HOST = 'theopentimes.localhost'

/** Every host this project owns, canonical or not, in preference order. */
export const OWNED: readonly string[] = [APEX, ...SHORT_DOMAINS, SUBDOMAIN]

export interface ResolvedDomains {
  mode: DomainMode
  /** The one host that serves content. Everything else points here. */
  canonical: string
  /** Hosts that answer only with a 301 to `canonical`. */
  redirects: string[]
  /** Canonical host first, then every redirecting host. */
  all: string[]
  /** `https://theopentimes.org` — no trailing slash, safe to append a path to. */
  url: string
}

/**
 * Resolve the domain layout from two environment values.
 *
 * Kept pure and exported so `buddy domain` can answer for an env file it is not
 * itself running under — reporting on `.env.production` from a local shell has
 * to read that file's values, not `process.env`.
 *
 * `APP_DOMAIN` is an escape hatch that wins outright, for a staging box or a
 * preview host that is neither declared mode. Otherwise `DOMAIN_MODE` picks,
 * and the default is the apex: a fresh checkout should describe the product as
 * it is meant to ship.
 *
 * `redirects` is derived rather than listed, so it can never disagree with
 * `canonical` — it is every owned host that is not canonical, plus the `www.`
 * form of the apex. `www` is only generated for the apex; a `www.theot.app`
 * nobody will type would just be another DNS record and another certificate to
 * keep alive.
 */
export function resolveDomains(source: { APP_DOMAIN?: string | null, DOMAIN_MODE?: string | null } = {}): ResolvedDomains {
  const override = String(source.APP_DOMAIN ?? '').trim()
  const mode: DomainMode = override
    ? 'domain'
    : (String(source.DOMAIN_MODE ?? 'domain').trim() === 'subdomain' ? 'subdomain' : 'domain')

  const canonical = override || (mode === 'subdomain' ? SUBDOMAIN : APEX)
  const redirects = [...OWNED, `www.${APEX}`].filter(d => d !== canonical)

  return { mode, canonical, redirects, all: [canonical, ...redirects], url: `https://${canonical}` }
}

const resolved: ResolvedDomains = resolveDomains({
  APP_DOMAIN: env.APP_DOMAIN as string | undefined,
  DOMAIN_MODE: env.DOMAIN_MODE as string | undefined,
})

export const mode: DomainMode = resolved.mode
export const canonical: string = resolved.canonical
export const redirects: readonly string[] = resolved.redirects
export const all: readonly string[] = resolved.all
export const url: string = resolved.url

/** Absolute URL for `path` on the canonical host. */
export function urlTo(path: string): string {
  return `${url}/${path.replace(/^\/+/, '')}`
}

/**
 * The redirect-only virtual hosts, in the shape `config/cloud.ts` wants.
 *
 * ts-cloud treats a site with a `redirect` and no `start`/`root` as a gateway
 * rule rather than a deployment, so these cost no process and no release
 * directory — just a server block each. `preservePath` is what makes
 * `theot.org/archive/2026` land on `theopentimes.org/archive/2026` instead of
 * dumping every short-link visitor on the front page.
 */
export function redirectSites(from: ResolvedDomains = resolved): Record<string, { domain: string, redirect: { to: string, status: number, preservePath: boolean } }> {
  return Object.fromEntries(
    from.redirects.map(domain => [
      `redirect-${domain.replace(/\./g, '-')}`,
      {
        domain,
        redirect: { to: from.url, status: 301, preservePath: true },
      },
    ]),
  )
}
