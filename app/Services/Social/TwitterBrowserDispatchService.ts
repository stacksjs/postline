import type { XBrowserImage, XBrowserWrite, XBrowserWriteResult } from '../../Support/Social/x-browser-write'
import { db } from '@stacksjs/database'
import { UserFacingError } from '../../Support/Http/user-error'
import { xBrowserPostId } from '../../Support/Social/x-browser-write'
import { now, uuid } from './support'
import { pauseTwitterBrowserReads, recordTwitterBrowserComposerMismatch, twitterBrowserSession } from './TwitterBrowserSession'

const database = db as any
const SUBMISSION_TIMEOUT = 45_000

interface BrowserPostInput {
  postId: number
  handle: string
  text: string
  images: XBrowserImage[]
}

interface Pending {
  work: XBrowserWrite
  postId: number
  claimed: boolean
  resolve: (outcome: XBrowserWriteResult) => void
}

function validResult(result: unknown): result is XBrowserWriteResult {
  if (!result || typeof result !== 'object' || !('state' in result)) return false
  if (result.state === 'published') return 'id' in result && xBrowserPostId(result.id)
  return result.state === 'refused' || result.state === 'uncertain' || result.state === 'attention'
    || result.state === 'layout' || result.state === 'unavailable'
}

export class TwitterBrowserDispatchService {
  // The desktop agent, its scheduler and the trusted workspace routes share
  // a process. The payload lives here only while the window prepares the post.
  // Authorization to click Post and the actual receipt must survive a restart.
  private pending: Pending | null = null

  constructor(private readonly deadlineMs = SUBMISSION_TIMEOUT) {}

  private async receipt(postId: number, handle: string): Promise<XBrowserWriteResult | null> {
    const receipt = await database.selectFrom('twitter_browser_dispatches')
      .select(['state', 'remote_id']).where('post_id', '=', postId).where('handle', '=', handle.toLowerCase())
      .executeTakeFirst()
    if (receipt?.state === 'published' && xBrowserPostId(receipt.remote_id)) return { state: 'published', id: receipt.remote_id }
    if (receipt?.state === 'submitting') return { state: 'uncertain' }
    return null
  }

  async dispatch(input: BrowserPostInput): Promise<XBrowserWriteResult> {
    const previous = await this.receipt(input.postId, input.handle)
    if (previous) return previous
    const session = await twitterBrowserSession()
    if (session.needsCheck || session.handle?.toLowerCase() !== input.handle.toLowerCase()) return { state: 'attention' }
    if (session.composerHealth === 'layout') return { state: 'layout' }
    if (session.composerHealth !== 'ready' || this.pending) return { state: 'unavailable' }

    const answer = Promise.withResolvers<XBrowserWriteResult>()
    const pending: Pending = {
      work: { token: uuid(), profile: session.profile, handle: session.handle, text: input.text, images: input.images },
      postId: input.postId,
      claimed: false,
      resolve: answer.resolve,
    }
    this.pending = pending
    const timeout = setTimeout(() => answer.resolve({ state: 'unavailable' }), this.deadlineMs)
    try {
      const result = await answer.promise
      if (result.state === 'unavailable') return await this.receipt(input.postId, input.handle) ?? result
      return result
    }
    finally {
      clearTimeout(timeout)
      if (this.pending === pending) this.pending = null
    }
  }

  claim(): XBrowserWrite | null {
    if (!this.pending || this.pending.claimed) return null
    this.pending.claimed = true
    return this.pending.work
  }

  async authorizeSubmit(token: unknown): Promise<boolean> {
    const pending = this.pending
    if (!pending?.claimed || pending.work.token !== token) return false
    const session = await twitterBrowserSession()
    if (this.pending !== pending || session.needsCheck || session.composerHealth !== 'ready'
      || session.profile !== pending.work.profile || session.handle?.toLowerCase() !== pending.work.handle.toLowerCase()) return false

    const stamp = now()
    const [granted] = await database.unsafe(`
      INSERT INTO twitter_browser_dispatches (uuid, post_id, handle, state, created_at, updated_at)
      VALUES (?, ?, ?, 'submitting', ?, ?)
      ON CONFLICT(post_id, handle) DO UPDATE SET
        uuid = excluded.uuid, state = 'submitting', remote_id = NULL, updated_at = excluded.updated_at
      WHERE twitter_browser_dispatches.state = 'refused'
      RETURNING uuid
    `, [token, pending.postId, pending.work.handle.toLowerCase(), stamp, stamp])
    return Boolean(granted && this.pending === pending)
  }

  async settle(token: unknown, result: unknown): Promise<boolean> {
    if (typeof token !== 'string' || !validResult(result))
      throw new UserFacingError('Postline could not read the X browser publish result.')

    // A late response from this attempt can still recover a receipt after the
    // caller timed out. A duplicate result cannot replace a stored receipt.
    if (result.state === 'published' || result.state === 'refused') {
      const recorded = await database.updateTable('twitter_browser_dispatches').set({
        state: result.state,
        remote_id: result.state === 'published' ? result.id : null,
        updated_at: now(),
      }).where('uuid', '=', token).where('state', '=', 'submitting').returning('uuid').executeTakeFirst()
      if (!recorded) return false
    }

    const pending = this.pending
    if (!pending?.claimed || pending.work.token !== token) return result.state === 'published' || result.state === 'refused'
    if (result.state === 'attention') await pauseTwitterBrowserReads('composer', pending.work.handle)
    if (result.state === 'layout') await recordTwitterBrowserComposerMismatch(pending.work.handle)
    const receipt = await this.receipt(pending.postId, pending.work.handle)
    pending.resolve(receipt ?? result)
    return true
  }
}

export const twitterBrowserDispatch = new TwitterBrowserDispatchService()
