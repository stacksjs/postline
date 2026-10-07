/**
 * OAuth `state` values in flight, between the consent redirect and the callback.
 *
 * This used to be one `pendingState` field per service, which was fine while
 * a network could hold one account: there was only ever one flow to remember.
 * With several accounts per network, two tabs connecting two X accounts start
 * two flows, and a single slot means the second overwrites the first — whose
 * callback then fails the state check (or, for X, loses its PKCE verifier).
 *
 * So: a small map keyed by the state itself, each entry carrying whatever the
 * callback needs (X keeps its PKCE verifier here), expiring after a TTL so an
 * abandoned consent screen cannot pin memory or be replayed hours later.
 * Module memory is still an adequate store: The Open Times runs one process
 * per workspace, and a restart only costs an in-flight flow a retry.
 */

const DEFAULT_TTL_MS = 15 * 60 * 1000
/** Bounds memory if something requests auth URLs in a loop. */
const MAX_PENDING = 32

export function randomOAuthState(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

export interface TakenOAuthState<T> {
  /** True when this exact state was issued here and has not expired. */
  found: boolean
  /**
   * True when no flow was pending at all — typically a restart between the
   * redirect and the callback. Callers keep their old leniency for this case.
   */
  noneOutstanding: boolean
  value?: T
}

export class PendingOAuthStates<T = true> {
  private entries = new Map<string, { value: T, expiresAt: number }>()

  constructor(private ttlMs = DEFAULT_TTL_MS, private now: () => number = () => Date.now()) {}

  /** Mint a new state for `value` and remember it. */
  issue(value: T, state = randomOAuthState()): string {
    this.prune()
    while (this.entries.size >= MAX_PENDING) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
    this.entries.set(state, { value, expiresAt: this.now() + this.ttlMs })
    return state
  }

  /** Consume a state. Single-use: a second callback with it is not found. */
  take(state: string): TakenOAuthState<T> {
    this.prune()
    const noneOutstanding = this.entries.size === 0
    const entry = state ? this.entries.get(state) : undefined
    if (!entry) return { found: false, noneOutstanding }

    this.entries.delete(state)
    return { found: true, noneOutstanding: false, value: entry.value }
  }

  get size(): number {
    this.prune()
    return this.entries.size
  }

  private prune(): void {
    const current = this.now()
    for (const [state, entry] of this.entries) {
      if (entry.expiresAt <= current) this.entries.delete(state)
    }
  }
}
