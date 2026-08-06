/**
 * Publishing a post is sending it.
 *
 * The gap between "it is on the site" and "it is in inboxes" is where most
 * writing tools lose people, so a blog publish queues a send in the same
 * action. Queues rather than delivers: a list of any size takes longer than a
 * request, and a publish that blocks on SMTP is a publish that times out.
 *
 * Delivery is batched and resumable. `delivered_count` on the send row is the
 * cursor, so a job that dies halfway through 4,000 readers picks up where it
 * stopped instead of mailing the first 2,000 people twice.
 */

import { db } from '@stacksjs/database'
import { config } from '@stacksjs/config'
import { env } from '@stacksjs/env'
import { mail } from '@stacksjs/email'
import { checkoutBaseUrl } from './BillingService'
import { publications } from './PublicationService'
import { now, uuid } from './Social/support'
import { subscribers } from './SubscriberService'

const database = db as any

/**
 * Recipients per batch.
 *
 * Small enough that a failure loses little work, large enough that a 5,000
 * reader list is not 5,000 separate job wake-ups.
 */
const BATCH_SIZE = 50

export type SendAudience = 'everyone' | 'paid'

export interface SendInput {
  sourceKey: string
  subject: string
  body: string
  url?: string | null
  audience?: SendAudience
  postId?: number | null
}

export interface SendView {
  id: number
  subject: string
  audience: string
  status: string
  recipientCount: number
  deliveredCount: number
  failedCount: number
  lastError: string | null
  sentAt: string | null
  createdAt: string | null
}

export function sendRow(row: any): SendView {
  return {
    id: Number(row.id),
    subject: String(row.subject),
    audience: String(row.audience || 'everyone'),
    status: String(row.status || 'queued'),
    recipientCount: Number(row.recipient_count || 0),
    deliveredCount: Number(row.delivered_count || 0),
    failedCount: Number(row.failed_count || 0),
    lastError: row.last_error || null,
    sentAt: row.sent_at || null,
    createdAt: row.created_at || null,
  }
}

/** Whether a mail transport is configured, so the UI can say so plainly. */
export function mailConfigured(): boolean {
  return Boolean(
    String(env.MAIL_HOST || '').trim()
    || String(env.SENDGRID_API_KEY || '').trim()
    || String(env.MAILGUN_API_KEY || '').trim()
    || String(env.AWS_ACCESS_KEY_ID || '').trim(),
  )
}

/** The publication's own from-address, falling back to the app's. */
function fromAddress(publicationName: string) {
  return {
    name: publicationName,
    address: config.email?.from?.address || String(env.MAIL_FROM_ADDRESS || 'hello@example.com'),
  }
}

/**
 * The plain-text half of a send.
 *
 * Every newsletter ships both parts. A text/plain alternative is what stops a
 * post being scored as spam by filters that distrust HTML-only mail, and it is
 * the version some readers actually prefer.
 */
function textBody(body: string, url: string | null, unsubscribeUrl: string): string {
  return [
    body,
    url ? `\nRead it online: ${url}` : '',
    `\n\nUnsubscribe: ${unsubscribeUrl}`,
  ].filter(Boolean).join('\n')
}

/** Minimal, readable HTML. Deliberately not a template engine call per reader. */
function htmlBody(subject: string, body: string, url: string | null, unsubscribeUrl: string): string {
  const paragraphs = body
    .split(/\n{2,}/)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => `<p style="margin:0 0 16px;line-height:1.6;color:#27272a;font-size:16px;">${escapeHtml(part).replace(/\n/g, '<br>')}</p>`)
    .join('')

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2;">
<tr><td style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;">
<tr><td style="padding:32px;">
<h1 style="margin:0 0 20px;font-size:24px;line-height:1.25;color:#09090b;">${escapeHtml(subject)}</h1>
${paragraphs}
${url ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(url)}" style="color:#2563eb;">Read it online</a></p>` : ''}
</td></tr>
<tr><td style="padding:0 32px 28px;">
<p style="margin:0;font-size:12px;color:#71717a;"><a href="${escapeHtml(unsubscribeUrl)}" style="color:#71717a;">Unsubscribe</a></p>
</td></tr>
</table></td></tr></table></body></html>`
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export class NewsletterService {
  /**
   * Queue a send.
   *
   * Idempotent on `(publication, sourceKey)`: republishing a post does not
   * mail it twice, which is the failure everybody notices and nobody forgives.
   */
  async queue(input: SendInput): Promise<SendView> {
    const publication = await publications.ensurePublication()
    const subject = String(input.subject || '').trim()
    const body = String(input.body || '').trim()

    if (!subject) throw new Error('A newsletter needs a subject.')
    if (!body) throw new Error('A newsletter needs a body.')

    const existing = await database
      .selectFrom('publication_sends')
      .selectAll()
      .where('publication_id', '=', publication.id)
      .where('source_key', '=', input.sourceKey)
      .executeTakeFirst()

    if (existing) return sendRow(existing)

    const sendUuid = uuid()
    await database.insertInto('publication_sends').values({
      uuid: sendUuid,
      source_key: input.sourceKey,
      subject: subject.slice(0, 300),
      body,
      url: input.url || null,
      audience: input.audience === 'paid' ? 'paid' : 'everyone',
      status: 'queued',
      recipient_count: 0,
      delivered_count: 0,
      failed_count: 0,
      last_error: null,
      sent_at: null,
      publication_id: publication.id,
      post_id: input.postId || null,
      created_at: now(),
      updated_at: now(),
    }).execute()

    return sendRow(await database
      .selectFrom('publication_sends')
      .selectAll()
      .where('uuid', '=', sendUuid)
      .executeTakeFirstOrThrow())
  }

  /** Sends waiting to go out, oldest first. */
  async pending(): Promise<SendView[]> {
    const rows = await database
      .selectFrom('publication_sends')
      .selectAll()
      .where('status', 'in', ['queued', 'sending'])
      .orderBy('created_at', 'asc')
      .execute()

    return rows.map(sendRow)
  }

  async list(limit = 50): Promise<SendView[]> {
    const publication = await publications.ensurePublication()
    const rows = await database
      .selectFrom('publication_sends')
      .selectAll()
      .where('publication_id', '=', publication.id)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute()

    return rows.map(sendRow)
  }

  /**
   * Deliver one batch of a send.
   *
   * Returns whether more work remains, so the job can loop without holding a
   * transaction open across an SMTP conversation. Recipients are ordered by id
   * and offset by `delivered_count + failed_count`, which is what makes the
   * cursor resumable: both counters only ever advance.
   */
  async deliverBatch(sendId: number): Promise<{ done: boolean, delivered: number, failed: number }> {
    const send = await database
      .selectFrom('publication_sends')
      .selectAll()
      .where('id', '=', sendId)
      .executeTakeFirst()

    if (!send || send.status === 'sent') return { done: true, delivered: 0, failed: 0 }

    const publication = await publications.ensurePublication()
    const recipients = await subscribers.recipients(send.audience === 'paid' ? 'paid' : 'everyone')

    if (send.status === 'queued') {
      await database.updateTable('publication_sends').set({
        status: 'sending',
        recipient_count: recipients.length,
        updated_at: now(),
      }).where('id', '=', sendId).execute()
    }

    const processed = Number(send.delivered_count || 0) + Number(send.failed_count || 0)
    const batch = recipients.slice(processed, processed + BATCH_SIZE)

    if (!batch.length) {
      await database.updateTable('publication_sends').set({
        status: 'sent',
        sent_at: now(),
        recipient_count: recipients.length,
        updated_at: now(),
      }).where('id', '=', sendId).execute()

      return { done: true, delivered: 0, failed: 0 }
    }

    // Same absolute-URL requirement as checkout: APP_URL is a bare host here,
    // and an unsubscribe link without a scheme is a dead link in a mail client.
    const base = checkoutBaseUrl(env.APP_URL)
    let delivered = 0
    let failed = 0
    let lastError: string | null = null

    for (const recipient of batch) {
      const row = await subscribers.findByEmail(recipient.email)
      const unsubscribeUrl = `${base}/api/postline/subscribe/unsubscribe?token=${encodeURIComponent(String(row?.unsubscribe_token || ''))}`
      const url = send.url ? (String(send.url).startsWith('http') ? String(send.url) : `${base}${send.url}`) : null

      try {
        await mail.send({
          to: [recipient.email],
          from: fromAddress(publication.name),
          subject: String(send.subject),
          html: htmlBody(String(send.subject), String(send.body), url, unsubscribeUrl),
          text: textBody(String(send.body), url, unsubscribeUrl),
          // One-click unsubscribe, which Gmail and Yahoo now require of bulk
          // senders and which keeps a publication out of the spam folder.
          headers: {
            'List-Unsubscribe': `<${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        } as any)
        delivered += 1
      }
      catch (error) {
        failed += 1
        lastError = error instanceof Error ? error.message : String(error)
      }
    }

    const nextDelivered = Number(send.delivered_count || 0) + delivered
    const nextFailed = Number(send.failed_count || 0) + failed
    const complete = nextDelivered + nextFailed >= recipients.length

    await database.updateTable('publication_sends').set({
      delivered_count: nextDelivered,
      failed_count: nextFailed,
      recipient_count: recipients.length,
      status: complete ? 'sent' : 'sending',
      sent_at: complete ? now() : null,
      last_error: lastError ? lastError.slice(0, 2000) : send.last_error,
      updated_at: now(),
    }).where('id', '=', sendId).execute()

    return { done: complete, delivered, failed }
  }

  /** Work through every pending send. Called by the scheduler. */
  async deliverPending(): Promise<{ sends: number, delivered: number, failed: number }> {
    const pending = await this.pending()
    let delivered = 0
    let failed = 0

    for (const send of pending) {
      // Bounded per tick so one enormous list cannot monopolise the worker.
      for (let batch = 0; batch < 20; batch++) {
        const result = await this.deliverBatch(send.id)
        delivered += result.delivered
        failed += result.failed
        if (result.done) break
      }
    }

    return { sends: pending.length, delivered, failed }
  }
}

export const newsletter = new NewsletterService()
