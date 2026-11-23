/**
 * Whether a failed publish is worth sending again, and when.
 *
 * A failed network used to stay failed until the owner pressed "publish now".
 * Most failures are not the post's fault: the network is rate limiting, or is
 * briefly down. Those are retried here on a schedule, a bounded number of
 * times, and a network that says when to come back (`Retry-After`) is taken
 * at its word. A failure that sending again cannot fix (a bad token, a post
 * the network rejects) is never retried: it needs the owner.
 *
 * Pure functions, so the schedule is tested without a clock or a network.
 */

export type FailureKind = 'rate-limited' | 'transient' | 'permanent'

export interface RetryHint {
  kind: FailureKind
  /** Seconds the network asked us to wait, when it said. */
  afterSeconds?: number
}

/** After this many failed sends a target stops retrying and needs attention. */
export const MAX_ATTEMPTS = 5

const MINUTE = 60
/** 1, 2, 4, 8 minutes: long enough for a blip, short enough to still be timely. */
const BASE_DELAY_SECONDS = MINUTE
const MAX_DELAY_SECONDS = 60 * MINUTE
/** A rate limit with no stated wait. X's windows are fifteen minutes. */
const RATE_LIMIT_DELAY_SECONDS = 15 * MINUTE
/** Never wait on a network's say-so for longer than this. */
const MAX_HONOURED_SECONDS = 6 * 60 * MINUTE

/** Read a `Retry-After` value: seconds, or an HTTP date. */
export function parseRetryAfter(value: unknown, nowMs: number = Date.now()): number | undefined {
  const text = String(value ?? '').trim()
  if (!text) return undefined
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.ceil(Number(text))
  const date = Date.parse(text)
  if (Number.isNaN(date)) return undefined
  return Math.max(0, Math.ceil((date - nowMs) / 1000))
}

/**
 * Classify a failure from whatever the driver threw. Drivers throw errors
 * carrying the HTTP `status`; some also carry `retryAfter` or the response
 * `headers`. An error with no status never reached the network or got no
 * answer, which is the definition of transient.
 */
export function classifyFailure(error: unknown, nowMs: number = Date.now()): RetryHint {
  const source = (error ?? {}) as { status?: unknown, retryAfter?: unknown, headers?: { get?: (name: string) => string | null }, message?: unknown }
  const status = Number(source.status)
  const message = String(source.message ?? error ?? '')
  const afterSeconds = parseRetryAfter(source.retryAfter ?? source.headers?.get?.('retry-after'), nowMs)

  if (status === 429 || /rate.?limit|too many requests/i.test(message))
    return { kind: 'rate-limited', ...(afterSeconds === undefined ? {} : { afterSeconds }) }
  if (status >= 500 || status === 408)
    return { kind: 'transient', ...(afterSeconds === undefined ? {} : { afterSeconds }) }
  if (status >= 400)
    return { kind: 'permanent' }
  if (/fetch failed|network|timed? ?out|ECONN|ENOTFOUND|EAI_AGAIN|socket|aborted/i.test(message))
    return { kind: 'transient' }
  // No status and nothing that reads like a network fault: a validation
  // message, a missing account. Sending again would say the same thing.
  return { kind: 'permanent' }
}

/**
 * When to send again, as a UTC `YYYY-MM-DD HH:MM:SS` string, or null when the
 * target should not be retried. `attempts` counts the sends made so far,
 * including the one that just failed.
 */
export function nextAttemptAt(hint: RetryHint | undefined, attempts: number, nowMs: number = Date.now()): string | null {
  if (!hint || hint.kind === 'permanent' || attempts >= MAX_ATTEMPTS) return null

  const backoff = Math.min(MAX_DELAY_SECONDS, BASE_DELAY_SECONDS * 2 ** Math.max(0, attempts - 1))
  const floor = hint.kind === 'rate-limited' ? RATE_LIMIT_DELAY_SECONDS : backoff
  // The network's own figure wins over ours, in either direction, but a
  // rate-limited send never goes sooner than our backoff would.
  const wait = hint.afterSeconds === undefined
    ? floor
    : Math.min(MAX_HONOURED_SECONDS, hint.kind === 'rate-limited' ? hint.afterSeconds : Math.max(hint.afterSeconds, backoff))

  return new Date(nowMs + wait * 1000).toISOString().slice(0, 19).replace('T', ' ')
}

/** Whether a stored `next_attempt_at` has arrived. */
export function isDue(nextAttempt: string | null | undefined, nowMs: number = Date.now()): boolean {
  if (!nextAttempt) return false
  const at = Date.parse(`${String(nextAttempt).replace(' ', 'T')}Z`)
  return !Number.isNaN(at) && at <= nowMs
}
