/**
 * Comments on published posts.
 *
 * The conversation stays attached to the thing being discussed, in a table the
 * publication owner can read, rather than scattered across the networks the
 * post was announced on.
 *
 * Access is per post, not per publication: `everyone`, `subscribers`, or
 * `paid`. That is a decision a writer makes piece by piece, because not every
 * post wants the same room.
 */

import type { DiscoverForm } from '../Support/Social/discover'
import { db } from '@stacksjs/database'
import { emit } from '@stacksjs/realtime'
import { publications } from './PublicationService'
import { now, uuid } from './Social/support'
import { normalizeEmail, isEmail, subscribers } from './SubscriberService'

const database = db as any

export type CommentAccess = 'everyone' | 'subscribers' | 'paid' | 'closed'

export interface CommentView {
  id: number
  parentId: number | null
  authorName: string
  body: string
  status: string
  createdAt: string | null
  /** Whether the commenter is a paying reader, shown as a badge. */
  supporter: boolean
  replies: CommentView[]
}

/** The realtime channel one post's thread broadcasts on. */
export function commentChannel(sourceKey: string): string {
  return `comments.${sourceKey}`
}

function commentRow(row: any, supporter: boolean): CommentView {
  return {
    id: Number(row.id),
    parentId: row.parent_id ? Number(row.parent_id) : null,
    authorName: String(row.author_name),
    body: String(row.body),
    status: String(row.status || 'visible'),
    createdAt: row.created_at || null,
    supporter,
    replies: [],
  }
}

/**
 * Assemble a flat list into a reply tree.
 *
 * Two passes rather than a recursive query: the whole thread is already in
 * memory, and a comment whose parent was removed is re-attached at the top
 * level rather than vanishing with it.
 */
export function threadComments(rows: CommentView[]): CommentView[] {
  const byId = new Map(rows.map(row => [row.id, { ...row, replies: [] as CommentView[] }]))
  const roots: CommentView[] = []

  for (const row of byId.values()) {
    const parent = row.parentId ? byId.get(row.parentId) : null
    if (parent) parent.replies.push(row)
    else roots.push(row)
  }

  return roots
}

export class CommentService {
  /**
   * The visible thread for one post.
   *
   * Pending and spam comments are never returned here. Moderation is the
   * owner's view, and leaking a held comment to the public would defeat
   * holding it.
   */
  async thread(sourceKey: string): Promise<CommentView[]> {
    const rows = await database
      .selectFrom('post_comments')
      .selectAll()
      .where('source_key', '=', String(sourceKey))
      .where('status', '=', 'visible')
      .orderBy('created_at', 'asc')
      .execute()

    return threadComments(await this.hydrate(rows))
  }

  /** Everything on a post, including held and spam. Owner-only. */
  async moderationQueue(limit = 100): Promise<CommentView[]> {
    const rows = await database
      .selectFrom('post_comments')
      .selectAll()
      .where('status', 'in', ['pending', 'spam'])
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute()

    return await this.hydrate(rows)
  }

  /**
   * Post a comment.
   *
   * The access check runs against the commenter's subscriber row, so a
   * paid-only thread is genuinely paid-only rather than merely hidden. A
   * commenter who is not a subscriber at all is asked to subscribe rather than
   * told their address was rejected, which is both friendlier and does not
   * confirm whether an address is on the list.
   */
  async post(input: {
    sourceKey: unknown
    body: unknown
    authorName: unknown
    authorEmail: unknown
    parentId?: unknown
    access?: CommentAccess
  }): Promise<CommentView> {
    const sourceKey = String(input.sourceKey || '').trim()
    const body = String(input.body || '').trim()
    const authorName = String(input.authorName || '').trim()
    const authorEmail = normalizeEmail(input.authorEmail)
    const access: CommentAccess = input.access || 'everyone'

    if (!sourceKey) throw new Error('That post does not accept comments.')
    if (access === 'closed') throw new Error('Comments are closed on this post.')
    if (!body) throw new Error('Write something before posting.')
    if (body.length > 5000) throw new Error('Comments are limited to 5000 characters.')
    if (!authorName) throw new Error('Add your name.')
    if (!isEmail(authorEmail)) throw new Error('Enter a valid email address.')

    const subscriber = await subscribers.findByEmail(authorEmail)

    if (access === 'subscribers' || access === 'paid') {
      const active = subscriber && subscriber.status === 'active'
      if (!active) throw new Error('Subscribe to join the conversation on this post.')
      if (access === 'paid' && subscriber.plan !== 'paid')
        throw new Error('This conversation is for paying subscribers.')
    }

    const parentId = Number(input.parentId) || null
    if (parentId) {
      const parent = await database
        .selectFrom('post_comments')
        .select(['id', 'source_key'])
        .where('id', '=', parentId)
        .executeTakeFirst()

      // A reply has to belong to the same post as its parent, or a comment
      // could be smuggled onto a thread by pointing at a parent elsewhere.
      if (!parent || String(parent.source_key) !== sourceKey)
        throw new Error('That comment is no longer there to reply to.')
    }

    const publication = await publications.ensurePublication()
    const commentUuid = uuid()

    // A known active subscriber posts straight through. Everyone else is held,
    // which is the cheapest spam control that does not punish real readers.
    const status = subscriber?.status === 'active' ? 'visible' : 'pending'

    await database.insertInto('post_comments').values({
      uuid: commentUuid,
      source_key: sourceKey,
      parent_id: parentId,
      author_name: authorName.slice(0, 120),
      author_email: authorEmail,
      body: body.slice(0, 5000),
      status,
      publication_id: publication.id,
      publication_subscriber_id: subscriber?.id || null,
      created_at: now(),
      updated_at: now(),
    }).execute()

    const created = await database
      .selectFrom('post_comments')
      .selectAll()
      .where('uuid', '=', commentUuid)
      .executeTakeFirstOrThrow()

    const view = commentRow(created, subscriber?.plan === 'paid')

    // Only visible comments are announced. Broadcasting a held one would show
    // it to every reader on the page, which is the opposite of holding it.
    if (status === 'visible') emit(commentChannel(sourceKey), 'CommentPosted', view)

    return view
  }

  /** Approve, hide, or mark spam. */
  async setStatus(id: number, status: 'visible' | 'pending' | 'spam' | 'removed'): Promise<CommentView> {
    const comment = await database
      .selectFrom('post_comments')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()

    if (!comment) throw new Error('That comment does not exist.')

    await database.updateTable('post_comments')
      .set({ status, updated_at: now() })
      .where('id', '=', id)
      .execute()

    const [view] = await this.hydrate([{ ...comment, status }])
    // `hydrate` maps one row to one view, so this cannot be empty. Asserting
    // rather than indexing keeps that guarantee explicit instead of leaving a
    // possibly-undefined value to be returned as a comment.
    if (!view) throw new Error('That comment could not be read back after updating.')

    emit(commentChannel(String(comment.source_key)), status === 'visible' ? 'CommentPosted' : 'CommentRemoved', view)

    return view
  }

  /** Counts per post, for rendering "12 comments" without loading them. */
  async countsFor(sourceKeys: string[]): Promise<Record<string, number>> {
    if (!sourceKeys.length) return {}

    const rows = await database
      .selectFrom('post_comments')
      .select(['source_key'])
      .where('status', '=', 'visible')
      .where('source_key', 'in', sourceKeys)
      .execute()

    const counts: Record<string, number> = {}
    for (const row of rows) {
      const key = String(row.source_key)
      counts[key] = (counts[key] || 0) + 1
    }

    return counts
  }

  /**
   * Attach the supporter flag in one query rather than one per comment.
   * A thread is tens of rows from a handful of subscribers.
   */
  private async hydrate(rows: any[]): Promise<CommentView[]> {
    if (!rows.length) return []

    const subscriberIds = [...new Set(rows.map(row => Number(row.publication_subscriber_id)).filter(Boolean))]
    const readers = subscriberIds.length
      ? await database.selectFrom('publication_subscribers').selectAll().where('id', 'in', subscriberIds).execute()
      : []
    const paid = new Set(readers.filter((reader: any) => reader.plan === 'paid').map((reader: any) => Number(reader.id)))

    return rows.map(row => commentRow(row, paid.has(Number(row.publication_subscriber_id))))
  }
}

export const comments = new CommentService()
