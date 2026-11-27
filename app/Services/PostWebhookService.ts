import type { CrosspostTargetResult } from '../Support/Social/types'
import { createHash, createHmac } from 'node:crypto'
import process from 'node:process'
import { db } from '@stacksjs/database'
import { log } from '@stacksjs/logging'
import { safeFetch } from '../Support/Http/safe-fetch'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

type Event = 'post.created' | 'post.published' | 'post.failed'
type Settings = { url: URL, secret: string }
type TargetOutcome = { target: string, status: 'published' | 'failed', retryAt?: string }

interface PostEventData {
  postId: number
  status: 'draft' | 'scheduled' | 'published' | 'failed'
  scheduledAt?: string | null
  reason?: 'missed' | 'interrupted' | 'unavailable'
  targets?: TargetOutcome[]
}

const MAX_ATTEMPTS = 8
const LEASE_MS = 90_000
export const WEBHOOK_KEEP_DAYS = 30

function stamp(time: number): string {
  return new Date(time).toISOString().slice(0, 19).replace('T', ' ')
}

function destinationKey(url: URL): string {
  return createHash('sha256').update(url.href).digest('hex')
}

function settings(): Settings | null {
  const address = process.env.POSTLINE_POST_WEBHOOK_URL?.trim()
  const secret = process.env.POSTLINE_POST_WEBHOOK_SECRET?.trim()
  if (!address && !secret) return null
  const url = address ? URL.parse(address) : null
  if (url?.protocol !== 'https:' || url.username || url.password || url.hash || !secret || Buffer.byteLength(secret) < 32)
    throw new Error('Post webhooks need an HTTPS URL and a signing secret of at least 32 bytes.')
  return { url, secret }
}

export function signedWebhookHeaders(id: string, payload: string, secret: string, time: number): Record<string, string> {
  const timestamp = String(Math.floor(time / 1000))
  const signature = createHmac('sha256', secret).update(`${id}.${timestamp}.${payload}`).digest('hex')
  return {
    'content-type': 'application/json',
    'postline-delivery': id,
    'postline-timestamp': timestamp,
    'postline-signature': `sha256=${signature}`,
  }
}

type Send = (url: URL, payload: string, headers: Record<string, string>) => Promise<number>

const deliver: Send = async (url, body, headers) => {
  const response = await safeFetch(url.href, { method: 'POST', body, headers, redirect: 'error', timeoutMs: 5000, maxBytes: 0 })
  return response.status
}

export class PostWebhookService {
  constructor(
    private readonly configuration: () => Settings | null = settings,
    private readonly send: Send = deliver,
    private readonly clock: () => number = Date.now,
  ) {}

  /** Write within the caller's post transaction. Network I/O belongs to the scheduler. */
  enqueue(tx: Transaction, type: Event, data: PostEventData): void {
    let config: Settings | null
    try { config = this.configuration() }
    catch {
      // A misconfigured integration must never prevent composing or publishing.
      // The delivery job reports the configuration error every time it runs.
      return
    }
    if (!config) return
    const milliseconds = this.clock()
    const id = crypto.randomUUID()
    const at = stamp(milliseconds)
    tx.insertInto('post_webhook_deliveries').values({
      uuid: id,
      destination_key: destinationKey(config.url),
      payload: JSON.stringify({ id, type, createdAt: new Date(milliseconds).toISOString(), data }),
      status: 'pending',
      available_at: at,
      created_at: at,
    }).execute()
  }

  enqueueAttempt(
    tx: Transaction, postId: number, results: readonly CrosspostTargetResult[],
    retries?: ReadonlyMap<CrosspostTargetResult, string>,
  ): void {
    if (!results.length) return
    const published = results.some(result => result.ok)
    this.enqueue(tx, published ? 'post.published' : 'post.failed', {
      postId,
      status: published ? 'published' : 'failed',
      targets: results.map(result => ({
        target: result.target || result.provider,
        status: result.ok ? 'published' : 'failed',
        retryAt: retries?.get(result),
      })),
    })
  }

  async deliverDue(): Promise<{ delivered: number, retried: number, failed: number }> {
    const report = { delivered: 0, retried: 0, failed: 0 }
    const config = this.configuration()
    if (!config) return report
    const key = destinationKey(config.url)
    const rows = await db.selectFrom('post_webhook_deliveries').select('id')
      .where('destination_key', '=', key).where('status', '=', 'pending').where('available_at', '<=', stamp(this.clock()))
      .orderBy('available_at', 'asc').orderBy('id', 'asc').limit(10).execute()

    for (const row of rows) {
      const lease = crypto.randomUUID()
      const time = this.clock()
      const claimed = await db.updateTable('post_webhook_deliveries')
        .set({ lease, available_at: stamp(time + LEASE_MS), updated_at: stamp(time) })
        .where('id', '=', row.id).where('status', '=', 'pending').where('available_at', '<=', stamp(time))
        .returning(['uuid', 'payload', 'attempts']).executeTakeFirst()
      if (!claimed) continue

      let status: number | undefined
      try {
        status = await this.send(config.url, claimed.payload, signedWebhookHeaders(claimed.uuid, claimed.payload, config.secret, time))
      }
      catch {
        // The transport error may contain the URL, including its query. Keep it out of logs.
      }

      const attempts = claimed.attempts + 1
      const success = status !== undefined && status >= 200 && status < 300
      const finished = this.clock()
      const pending = !success && attempts < MAX_ATTEMPTS
      const outcome = success ? 'delivered' : pending ? 'pending' : 'failed'
      const saved = await db.updateTable('post_webhook_deliveries').set({
        status: outcome,
        attempts,
        available_at: stamp(finished + (pending ? 60_000 * 2 ** (attempts - 1) : 0)),
        lease: null,
        failure: success ? null : status === undefined ? 'Delivery transport failed' : `HTTP ${status}`,
        updated_at: stamp(finished),
      }).where('id', '=', row.id).where('lease', '=', lease).returning('id').executeTakeFirst()
      if (!saved) continue
      if (success) report.delivered++
      else if (pending) report.retried++
      else {
        report.failed++
        log.warn(`[postline] webhook delivery ${claimed.uuid} exhausted its attempts`)
      }
    }
    return report
  }
}

export const postWebhooks = new PostWebhookService()
