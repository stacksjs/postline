import type { XBrowserImage, XBrowserWrite, XBrowserWriteResult } from '../../Support/Social/x-browser-write'
import { db, sqliteWriteOptions } from '@stacksjs/database'
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
  postIds: number[]
  claimed: boolean
  resolve: (outcome: XBrowserWriteResult) => void
}

function validResult(result: unknown): result is XBrowserWriteResult {
  if (!result || typeof result !== 'object' || !('state' in result)) return false
  if (result.state === 'published') return 'id' in result && xBrowserPostId(result.id)
  if (result.state === 'thread') return 'ids' in result && Array.isArray(result.ids) && result.ids.every(xBrowserPostId)
    && new Set(result.ids).size === result.ids.length && (!('attention' in result) || result.attention === true)
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

  async dispatch(input: BrowserPostInput): Promise<Exclude<XBrowserWriteResult, { state: 'thread' }>> {
    const previous = await this.receipt(input.postId, input.handle)
    const result = previous ?? await this.send([input.postId], input.handle, input.text, input.images)
    return result.state === 'thread' ? { state: 'uncertain' } : result
  }

  async dispatchThread(
    posts: Array<{ id: number, body: string }>, handle: string, images: () => Promise<XBrowserImage[]>, allowNewBatch: boolean,
  ): Promise<XBrowserWriteResult> {
    const [first, ...replies] = posts
    if (!first || !replies.length || replies.some((post, i) => post.id <= posts[i]!.id))
      throw new UserFacingError('Postline could not order the X browser thread.')
    const ids = posts.map(post => post.id)
    const previous = await this.threadReceipt(ids, handle)
    if (previous) return previous
    // Older archives can have published targets without their receipts.
    // In that case a new Post all would repeat the confirmed segments.
    if (!allowNewBatch) return { state: 'uncertain' }
    return await this.send(ids, handle, first.body, await images(), replies.map(post => post.body))
  }

  private async threadReceipt(postIds: number[], handle: string): Promise<XBrowserWriteResult | null> {
    const rows: Array<{ post_id: number, state: string, remote_id: string | null }> = await database.selectFrom('twitter_browser_dispatches')
      .select(['post_id', 'state', 'remote_id']).where('post_id', 'in', postIds).where('handle', '=', handle.toLowerCase())
      .where('state', 'in', ['published', 'submitting']).orderBy('post_id', 'asc').execute()
    if (!rows.length) return null

    // A receipt is final for this segment until the owner verifies it. Preserve
    // acknowledged segments even when a late response or restart left Queue stale.
    const ids: string[] = []
    for (const [index, postId] of postIds.entries()) {
      const row = rows[index]
      if (Number(row?.post_id) !== postId || row?.state !== 'published' || !xBrowserPostId(row.remote_id)) break
      ids.push(row.remote_id)
    }
    return { state: 'thread', ids }
  }

  private async send(postIds: number[], handle: string, text: string, images: XBrowserImage[], replies?: string[]): Promise<XBrowserWriteResult> {
    const session = await twitterBrowserSession()
    if (session.needsCheck || session.handle?.toLowerCase() !== handle.toLowerCase()) return { state: 'attention' }
    if (session.composerHealth === 'layout') return { state: 'layout' }
    if (session.composerHealth !== 'ready' || this.pending) return { state: 'unavailable' }

    const answer = Promise.withResolvers<XBrowserWriteResult>()
    const pending: Pending = {
      work: { token: uuid(), profile: session.profile, handle: session.handle, text, images, replies },
      postIds,
      claimed: false,
      resolve: answer.resolve,
    }
    this.pending = pending
    const extra = replies ? Math.min(replies.length, 50) * 1200 + 15_000 : 0
    const timeout = setTimeout(() => answer.resolve({ state: 'unavailable' }), this.deadlineMs + extra)
    try {
      const result = await answer.promise
      if (result.state === 'unavailable') {
        const receipt = replies ? await this.threadReceipt(postIds, handle) : await this.receipt(postIds[0]!, handle)
        return receipt ?? result
      }
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
    const handle = pending.work.handle.toLowerCase()
    const isThread = pending.postIds.length > 1
    return await database.transaction((tx: typeof database) => {
      const previous = tx.selectFrom('twitter_browser_dispatches').select('id').where('post_id', 'in', pending.postIds)
        .where('handle', '=', handle).where('state', 'in', ['submitting', 'published']).executeTakeFirst()
      if (previous || this.pending !== pending) return false

      for (const postId of pending.postIds) {
        tx.unsafe(`
          INSERT INTO twitter_browser_dispatches (uuid, post_id, handle, state, batch_token, created_at, updated_at)
          VALUES (?, ?, ?, 'submitting', ?, ?, ?)
          ON CONFLICT(post_id, handle) DO UPDATE SET
            uuid = excluded.uuid, state = 'submitting', remote_id = NULL,
            batch_token = excluded.batch_token, updated_at = excluded.updated_at
          WHERE twitter_browser_dispatches.state = 'refused'
        `, [isThread ? uuid() : token, postId, handle, isThread ? token : null, stamp, stamp]).execute()
      }
      return true
    }, sqliteWriteOptions())
  }

  private async settleThread(token: string, result: Extract<XBrowserWriteResult, { state: 'thread' }>): Promise<boolean> {
    const rows = await database.transaction((tx: typeof database) => {
      const receipts: Array<{ id: number, handle: string, state: string, remote_id: string | null }> = tx.selectFrom('twitter_browser_dispatches')
        .select(['id', 'handle', 'state', 'remote_id']).where('batch_token', '=', token).orderBy('post_id', 'asc').execute()
      if (receipts.length < 2 || result.ids.length > receipts.length || result.ids.some((id, index) => {
        const receipt = receipts[index]!
        return receipt.state !== 'submitting' && receipt.remote_id !== id
      })) return null

      const at = now()
      for (const [index, id] of result.ids.entries()) {
        tx.updateTable('twitter_browser_dispatches').set({ state: 'published', remote_id: id, updated_at: at })
          .where('id', '=', receipts[index]!.id).where('state', '=', 'submitting').execute()
      }
      return receipts
    }, sqliteWriteOptions())
    if (!rows) return false
    if (result.attention) await pauseTwitterBrowserReads('composer', rows[0]!.handle)
    const pending = this.pending
    if (pending?.claimed && pending.work.token === token) pending.resolve(result)
    return true
  }

  async settle(token: unknown, result: unknown): Promise<boolean> {
    if (typeof token !== 'string' || !validResult(result))
      throw new UserFacingError('Postline could not read the X browser publish result.')

    if (result.state === 'thread') return await this.settleThread(token, result)

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
    const receipt = pending.work.replies
      ? await this.threadReceipt(pending.postIds, pending.work.handle)
      : await this.receipt(pending.postIds[0]!, pending.work.handle)
    pending.resolve(receipt ?? result)
    return true
  }
}

export const twitterBrowserDispatch = new TwitterBrowserDispatchService()
