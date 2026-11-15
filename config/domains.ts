import { env } from '@stacksjs/env'

/**
 * **Domains**
 *
 * The single source of truth for every hostname Postline answers on.
 *
 * `config/app.ts`, `config/dns.ts`, `config/email.ts` and `config/cloud.ts` all
 * need to agree on which host is canonical and which ones merely redirect to
 * it. When each of them spelled a domain out itself they drifted, so every one
 * of them reads from here.
 *
 * TWO MODES, ONE CANONICAL HOST
 *
 * The app can live at a subdomain of the shared Stacks box
 * (`postline.stacksjs.com`) or at an apex domain of its own. Exactly one of
 * them is canonical at a time, and every other owned host redirects to
 * whichever one that is — including the subdomain once an apex takes over, so
 * links handed out before the move keep working instead of 404ing.
 *
 * Postline has no domain of its own yet, so `APEX` is `null` and the subdomain
 * is the only mode that resolves. Registering a domain is a one-line change
 * here (`APEX`), after which `buddy domain:use domain` flips to it.
 */

export type DomainMode = 'subdomain' | 'domain'

/**
 * Postline's own apex domain.
 *
 * TODO: set this once a real Postline domain is registered. While it is `null`
 * the app is served from `SUBDOMAIN`, `DOMAIN_MODE=domain` is ignored, and mail
 * is sent from `FALLBACK_MAIL_DOMAIN`.
 */
export const APEX: string | null = null

/**
 * The tenant hostname on the shared `stacks` box. The canonical production
 * host until Postline has a domain of its own; a redirect afterwards.
 */
export const SUBDOMAIN = 'postline.stacksjs.com'

/**
 * The zone mail is sent from while there is no apex. It is the parent zone of
 * `SUBDOMAIN`; config/email.ts prefers `MAIL_DOMAIN`, then `APEX`, then this.
 */
export const FALLBACK_MAIL_DOMAIN = 'stacksjs.com'

/**
 * The development host. `buddy setup:ssl` issues a certificate for it and adds
 * it to /etc/hosts, and it is the origin every OAuth redirect URL in
 * `.env.example` is written against.
 */
export const LOCAL_HOST = 'postline.localhost'

/** Every host this project owns, canonical or not, in preference order. */
export const OWNED: readonly string[] = [...(APEX ? [APEX] : []), SUBDOMAIN]

export interface ResolvedDomains {
  mode: DomainMode
  /** The one host that serves content. Everything else points here. */
  canonical: string
  /** Hosts that answer only with a 301 to `canonical`. */
  redirects: string[]
  /** Canonical host first, then every redirecting host. */
  all: string[]
  /** `https://<canonical>` — no trailing slash, safe to append a path to. */
  url: string
}

/**
 * Resolve the domain layout from two environment values.
 *
 * Kept pure and exported so `buddy domain` can answer for an env file it is not
 * itself running under.
 *
 * `APP_DOMAIN` is an escape hatch that wins outright, for a staging box or a
 * preview host that is neither declared mode. Otherwise `DOMAIN_MODE` picks:
 * `domain` means the apex, and only takes effect once `APEX` is set — until
 * then both modes resolve to the subdomain rather than to an empty host.
 *
 * `redirects` is derived rather than listed, so it can never disagree with
 * `canonical` — it is every owned host that is not canonical, plus the `www.`
 * form of the apex when there is one.
 */
export function resolveDomains(
  source: { APP_DOMAIN?: string | null, DOMAIN_MODE?: string | null } = {},
  apex: string | null = APEX,
): ResolvedDomains {
  const override = String(source.APP_DOMAIN ?? '').trim()
  const wantsApex = String(source.DOMAIN_MODE ?? '').trim() === 'domain' && Boolean(apex)
  const mode: DomainMode = override || wantsApex ? 'domain' : 'subdomain'

  const canonical = override || (wantsApex && apex ? apex : SUBDOMAIN)
  const owned = [...(apex ? [apex, `www.${apex}`] : []), SUBDOMAIN]
  const redirects = owned.filter(d => d !== canonical)

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
 * directory — just a server block each. `preservePath` keeps a deep link deep.
 * Empty while the subdomain is the only owned host.
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
