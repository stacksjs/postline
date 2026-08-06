/**
 * The reader-facing view of a published post.
 *
 * The paywall lives here rather than in the template, because a paywall
 * enforced while rendering is a paywall that ships the full text to the
 * browser and hides it with CSS. `readPost` decides what a given reader is
 * entitled to and returns only that: the body a locked reader receives is
 * genuinely the preview, and view-source shows nothing more.
 */

import { db } from '@stacksjs/database'
import { comments } from './CommentService'
import { publications } from './PublicationService'
import { billing } from './BillingService'
import { excerptOf } from '../Support/Social/discover'
import { normalizeEmail, subscribers } from './SubscriberService'

const database = db as any

export interface PublicPost {
  title: string
  slug: string
  /** Either the whole post, or the preview when locked. */
  body: string
  publishedAt: string | null
  access: string
  /** Whether the reader is seeing a cut-down version. */
  locked: boolean
  commentCount: number
  publication: {
    name: string
    tagline: string | null
    authorName: string | null
    domain: string | null
  }
  /** Tiers to offer a locked reader. Empty when nothing is for sale. */
  tiers: Array<{ id: number, name: string, amountCents: number, currency: string, interval: string }>
}

export class PublicPostService {
  /**
   * Read one post as a given reader.
   *
   * `readerEmail` is whatever the reader claims. That is enough to unlock,
   * because the only thing behind the wall is writing, and the alternative is
   * making every reader hold an account to read an article they paid for. It
   * is checked against an active paid subscription, never merely against
   * being on the list.
   */
  async readPost(slug: string, readerEmail?: unknown): Promise<PublicPost | null> {
    const row = await database
      .selectFrom('blog_posts')
      .selectAll()
      .where('slug', '=', String(slug || ''))
      .where('status', '=', 'published')
      .executeTakeFirst()

    if (!row) return null

    const publication = await publications.ensurePublication()
    const access = String(row.access || 'free')
    const body = String(row.body || '')
    const entitled = access === 'free' || await this.entitled(readerEmail)
    const counts = await comments.countsFor([`blog:${row.slug}`])

    return {
      title: String(row.title),
      slug: String(row.slug),
      body: entitled ? body : this.preview(body, Number(row.preview_chars || 600)),
      publishedAt: row.published_at || null,
      access,
      locked: !entitled,
      commentCount: counts[`blog:${row.slug}`] || 0,
      publication: {
        name: publication.name,
        tagline: publication.tagline,
        authorName: publication.authorName,
        domain: publication.domain,
      },
      // Only offered when the reader cannot already read it. Showing prices to
      // somebody who has already paid is the most annoying bug in the genre.
      tiers: entitled ? [] : (await billing.publicTiers()).map(tier => ({
        id: tier.id,
        name: tier.name,
        amountCents: tier.amountCents,
        currency: tier.currency,
        interval: tier.interval,
      })),
    }
  }

  /** Published posts for the public index, newest first. */
  async list(limit = 30) {
    const rows = await database
      .selectFrom('blog_posts')
      .selectAll()
      .where('status', '=', 'published')
      .orderBy('published_at', 'desc')
      .limit(limit)
      .execute()

    return rows.map((row: any) => ({
      title: String(row.title),
      slug: String(row.slug),
      excerpt: row.excerpt || excerptOf(String(row.body || ''), 200),
      publishedAt: row.published_at || null,
      access: String(row.access || 'free'),
    }))
  }

  /**
   * Whether a reader may read paid posts.
   *
   * Requires an active paid subscription, not merely a subscriber row: a free
   * reader on the list is exactly the person the paywall is for.
   */
  private async entitled(readerEmail: unknown): Promise<boolean> {
    const email = normalizeEmail(readerEmail)
    if (!email) return false

    const reader = await subscribers.findByEmail(email)

    return Boolean(reader && reader.status === 'active' && reader.plan === 'paid')
  }

  /**
   * Cut a preview on a paragraph boundary where possible.
   *
   * Stopping mid-sentence reads as a bug rather than as an invitation, so this
   * prefers the last paragraph break inside the limit and only falls back to a
   * word boundary when the opening paragraph is already longer than the cut.
   */
  private preview(body: string, limit: number): string {
    const text = String(body || '')
    if (text.length <= limit) return text

    const cut = text.slice(0, limit)
    const paragraph = cut.lastIndexOf('\n\n')
    if (paragraph > limit * 0.4) return cut.slice(0, paragraph).trimEnd()

    const space = cut.lastIndexOf(' ')

    return (space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()
  }
}

export const publicPosts = new PublicPostService()
