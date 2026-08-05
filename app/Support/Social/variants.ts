import type { PublishContent, SocialProvider } from './types'

/**
 * Every provider a variant may target. Kept as a runtime list (the
 * `SocialProvider` union is compile-time only) so untrusted input — a request
 * field or a stored JSON blob — can be filtered down to known keys.
 */
const PROVIDERS: SocialProvider[] = [
  'bluesky',
  'twitter',
  'mastodon',
  'facebook',
  'instagram',
  'tiktok',
  'linkedin',
  'threads',
  'blog',
  'postline',
]

export type VariantMap = Partial<Record<SocialProvider, string>>

/** Outcome of reading an untrusted `variants` request field. */
export type ParsedVariantsField =
  | { ok: true, variants: VariantMap | null }
  | { ok: false }

/**
 * Narrow untrusted input to a variant map: an object (or JSON string) keyed by
 * provider with string bodies.
 *
 * Unknown keys are dropped, non-string values are dropped, and blank values are
 * dropped rather than kept — a variant the user cleared must inherit the shared
 * body, never publish an empty post. Returns undefined when nothing survives,
 * so callers can omit the key entirely instead of storing `{}`.
 */
export function sanitizeVariants(raw: unknown): VariantMap | undefined {
  let source = raw
  if (typeof source === 'string') {
    const text = source.trim()
    if (!text) return undefined
    try {
      source = JSON.parse(text)
    }
    catch {
      return undefined
    }
  }

  if (!source || typeof source !== 'object' || Array.isArray(source)) return undefined

  const record = source as Record<string, unknown>
  const variants: VariantMap = {}
  for (const provider of PROVIDERS) {
    const value = record[provider]
    if (typeof value !== 'string') continue
    if (!value.trim()) continue
    variants[provider] = value
  }

  return Object.keys(variants).length ? variants : undefined
}

/**
 * Parse a submitted `variants` field, separating "could not understand this"
 * from "explicitly empty".
 *
 * `sanitizeVariants` collapses both to undefined, which is fine on the way in
 * but dangerous on an edit: callers map undefined to "clear", so a corrupted or
 * truncated payload would silently delete every stored override and still
 * return success. Callers should reject `{ ok: false }` rather than treat it as
 * an empty submission.
 */
export function parseVariantsField(raw: unknown): ParsedVariantsField {
  if (raw === null || raw === undefined) return { ok: true, variants: null }

  let source = raw
  if (typeof source === 'string') {
    const text = source.trim()
    if (!text) return { ok: true, variants: null }
    try {
      source = JSON.parse(text)
    }
    catch {
      return { ok: false }
    }
  }

  if (!source || typeof source !== 'object' || Array.isArray(source)) return { ok: false }
  return { ok: true, variants: sanitizeVariants(source) || null }
}

/**
 * Resolve what an edit should store, given the submitted value and whatever is
 * already on the post. Tri-state, mirroring how attached media is handled:
 *
 *   undefined -> keep the stored variants (field was not submitted)
 *   null      -> clear them
 *   object    -> replace them wholesale
 *
 * The `keep` branch is the important one: `QueueService.update` rewrites
 * `posts.content` in full, so without it every override would silently vanish
 * the first time a queued post was edited.
 */
export function resolveStoredVariants(
  submitted: VariantMap | null | undefined,
  existing: unknown,
): VariantMap | undefined {
  if (submitted === undefined) return sanitizeVariants(existing)
  if (submitted === null) return undefined
  return sanitizeVariants(submitted)
}

/**
 * The text a provider actually publishes: its own variant when one is set,
 * otherwise the shared body.
 *
 * Blank variants inherit for the same reason `sanitizeVariants` drops them —
 * clearing an override should fall back, not publish nothing. This is the only
 * place the shared-vs-override decision is made, so drivers stay unaware that
 * variants exist at all.
 */
export function resolveVariantBody(
  body: string,
  provider: SocialProvider,
  content?: PublishContent,
): string {
  const variant = content?.variants?.[provider]
  return typeof variant === 'string' && variant.trim() ? variant : body
}
