import type { SocialProvider } from './types'

/**
 * Publish targets: which network, and which connected account on it.
 *
 * A target travels as a short string so it fits the comma-joined `providers`
 * field every publish, queue and campaign path already sends:
 *
 *   "bluesky"      the network's default account (most recently refreshed)
 *   "bluesky:12"   exactly social_identities row 12
 *
 * The bare form is not legacy-only. Campaigns plan per network, and a queued
 * post that names a network rather than an account should follow whichever
 * account is the default when it publishes, not when it was scheduled. So the
 * bare form stays first-class and is resolved as late as possible, in
 * `CrosspostService`.
 *
 * Everything here is pure: parsing happens on untrusted request input, and the
 * de-duplication rules are the part most worth pinning with tests.
 */

/**
 * Networks whose targets name an account. The Open Times and the blog are ours,
 * so they have no `social_identities` row and an account id on them means
 * nothing — it is dropped rather than rejected.
 */
export const ACCOUNT_PROVIDERS: readonly SocialProvider[] = [
  'bluesky',
  'twitter',
  'mastodon',
  'linkedin',
  'instagram',
  'threads',
]

export interface PublishTarget {
  provider: SocialProvider
  /** A `social_identities.id`, or null for "the network's default account". */
  identityId: number | null
}

export function isAccountProvider(provider: string): boolean {
  return (ACCOUNT_PROVIDERS as readonly string[]).includes(provider)
}

/** The canonical string form, and the key every de-dup in the app uses. */
export function targetKey(target: PublishTarget): string {
  return target.identityId ? `${target.provider}:${target.identityId}` : target.provider
}

/**
 * Parse one target spec. Returns null for anything unrecognised: an unknown or
 * unavailable network, or an account id that is not a positive integer.
 *
 * A malformed id is rejected rather than downgraded to the bare network. The
 * user picked one specific account; publishing to a different one because the
 * id did not parse would be worse than not publishing there at all.
 */
export function parseTarget(raw: unknown, available?: Iterable<string>): PublishTarget | null {
  if (raw && typeof raw === 'object') {
    const candidate = raw as Partial<PublishTarget>
    if (typeof candidate.provider !== 'string') return null
    return parseTarget(candidate.identityId ? `${candidate.provider}:${candidate.identityId}` : candidate.provider, available)
  }
  if (typeof raw !== 'string') return null

  const value = raw.trim().toLowerCase()
  if (!value) return null

  const separator = value.indexOf(':')
  const provider = (separator === -1 ? value : value.slice(0, separator)).trim()
  const idPart = separator === -1 ? '' : value.slice(separator + 1).trim()

  if (!provider) return null
  if (available && !new Set(available).has(provider)) return null
  // `bluesky:` is a spec whose account went missing on the way, not a request
  // for the default account.
  if (separator !== -1 && !idPart) return null

  if (!idPart || !isAccountProvider(provider))
    return { provider: provider as SocialProvider, identityId: null }

  if (!/^\d{1,12}$/.test(idPart)) return null
  const identityId = Number(idPart)
  if (!Number.isSafeInteger(identityId) || identityId <= 0) return null

  return { provider: provider as SocialProvider, identityId }
}

/**
 * Parse a list of specs: a comma-joined string (the form fields send) or an
 * array (JSON callers, campaigns). Unparseable entries are dropped and exact
 * duplicates collapse, preserving first-seen order.
 */
export function parseTargets(raw: unknown, available?: Iterable<string>): PublishTarget[] {
  const allowed = available ? [...available] : undefined
  const entries = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',')
      : []

  const parsed: PublishTarget[] = []
  for (const entry of entries) {
    const target = parseTarget(entry, allowed)
    if (target) parsed.push(target)
  }
  return dedupeTargets(parsed)
}

/**
 * Collapse targets that name the same account. Two different accounts on the
 * same network are two targets — that is the whole point — so this keys on
 * (provider, identityId), never on provider alone.
 */
export function dedupeTargets(targets: readonly PublishTarget[]): PublishTarget[] {
  const seen = new Set<string>()
  const unique: PublishTarget[] = []
  for (const target of targets) {
    const key = targetKey(target)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(target)
  }
  return unique
}

/**
 * Pin bare targets to a concrete account, then de-dup again.
 *
 * The second pass is what stops `bluesky` + `bluesky:12` posting twice when 12
 * is the default account. A network with no default (nothing connected yet)
 * stays bare, so its publisher can still fall back to an env-configured
 * account or record why it could not publish.
 */
export function resolveTargets(
  targets: readonly PublishTarget[],
  defaults: Partial<Record<SocialProvider, number | null>>,
): PublishTarget[] {
  return dedupeTargets(targets.map((target) => {
    if (target.identityId || !isAccountProvider(target.provider)) return target
    const fallback = defaults[target.provider]
    return fallback ? { provider: target.provider, identityId: fallback } : target
  }))
}

/** The distinct networks a target list reaches, in first-seen order. */
export function targetProviders(targets: readonly PublishTarget[]): SocialProvider[] {
  return [...new Set(targets.map(target => target.provider))]
}
