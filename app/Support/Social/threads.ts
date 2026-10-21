import type { CrosspostTargetResult, PublishContent } from './types'

/**
 * The two rules that make a thread a thread, kept pure and out of
 * `CrosspostService.publishThread`.
 *
 * The chaining itself is a few lines, but they are the subtle few: they decide
 * which segment replies to which, per account, across providers that thread
 * natively and providers that do not. Interleaved with the `posts` row writes
 * they cannot be exercised without a database, which is why they had no test
 * while every driver around them did. Pure functions here, the same way the
 * identity matching rules live in `accounts.ts` rather than in `identities.ts`.
 */

/** A reply chain's refs: where the thread starts, and what to reply to next. */
export interface ThreadChain {
  root: { uri: string, cid: string }
  parent: { uri: string, cid: string }
}

/**
 * Advance one target's chain with the segment that just published.
 *
 * A result without both `uri` and `cid` leaves the chain untouched, and that
 * absence is the whole signal: `cid` is an AT-protocol content hash, so
 * Bluesky returns one and the other networks do not. A provider that cannot
 * identify the post it just made cannot be replied to, so its segments go out
 * as independent posts. No provider list is consulted and none has to be kept
 * up to date — a network that gains native threading starts chaining as soon
 * as its driver returns a cid.
 *
 * `root` is pinned on the first chained segment and never moves; `parent`
 * follows the most recent one. That is what makes segment 3 reply to segment 2
 * while both still hang off segment 1.
 */
export function advanceChain(
  current: ThreadChain | undefined,
  result: Pick<CrosspostTargetResult, 'ok' | 'uri' | 'cid'>,
): ThreadChain | undefined {
  if (!result.ok || !result.uri || !result.cid)
    return current

  const ref = { uri: result.uri, cid: result.cid }
  return { root: current?.root || ref, parent: ref }
}

/**
 * The content one segment publishes with.
 *
 * The first segment carries the post's content — link preview, media — because
 * a card repeated on every segment is noise, and the networks that render one
 * render it on the post that opens the thread. Later segments carry only their
 * reply refs.
 *
 * Variants are stripped deliberately rather than passed through. It is
 * genuinely ambiguous whether a per-network override should replace the first
 * segment or the entire chain, so a thread always publishes its shared
 * segments. Dropping the field here makes that a decision someone took, not an
 * accident of every driver happening to ignore it.
 */
export function threadSegmentContent(
  index: number,
  content: PublishContent | undefined,
  chain: ThreadChain | undefined,
): PublishContent | undefined {
  if (index === 0)
    return content ? { ...content, variants: undefined } : undefined

  return chain ? { reply: chain } : undefined
}
