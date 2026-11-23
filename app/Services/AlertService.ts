/**
 * Tell the owner when something needs them.
 *
 * A failed post or a refused sign-in used to be visible only to someone
 * looking at the right page. Each is now kept as an alert the app shows until
 * it is read, and sent to a webhook when one is configured
 * (`POSTLINE_ALERT_WEBHOOK_URL`), so it reaches the owner with the app closed.
 *
 * Raising an alert must never break what raised it: a webhook that is down
 * cannot be allowed to fail a publish.
 */
import process from 'node:process'
import { db } from '@stacksjs/database'
import { log } from '@stacksjs/logging'

const database = db as any

export type AlertKind = 'post-failed' | 'post-missed' | 'account-expired'

export interface AlertInput {
  kind: AlertKind
  title: string
  body?: string
  /** A path in the app where it can be dealt with. */
  link?: string
  /** One alert per key, however often the same thing is noticed. */
  key: string
}

export interface AlertView {
  id: number
  kind: AlertKind
  title: string
  body: string | null
  link: string | null
  at: string | null
  read: boolean
}

type Send = (url: string, payload: Record<string, unknown>) => Promise<void>

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

/** POST the alert as JSON. `text` is there so Slack and Discord-style hooks show it as it is. */
const postJson: Send = async (url, payload) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5_000),
    redirect: 'error',
  })
  if (!response.ok) throw new Error(`the webhook answered ${response.status}`)
}

export class AlertService {
  constructor(private readonly send: Send = postJson, private readonly webhookUrl: () => string = () => String(process.env.POSTLINE_ALERT_WEBHOOK_URL || '').trim()) {}

  /** Record an alert once and pass it on. Returns false when it was already raised. */
  async raise(input: AlertInput): Promise<boolean> {
    try {
      const existing = await database.selectFrom('alerts').select(['id']).where('dedupe_key', '=', input.key).executeTakeFirst()
      if (existing) return false

      const at = stamp()
      await database.insertInto('alerts').values({
        kind: input.kind,
        title: input.title.slice(0, 200),
        body: input.body ? input.body.slice(0, 1000) : null,
        link: input.link || null,
        dedupe_key: input.key.slice(0, 190),
        created_at: at,
        updated_at: at,
      }).execute()
    }
    catch (error) {
      // Two processes noticing the same thing together: the unique key lets
      // one in, and the other has nothing left to do.
      if (/unique/i.test(String(error))) return false
      log.warn(`[postline] could not record an alert (${input.title}): ${error instanceof Error ? error.message : String(error)}`)
      return false
    }

    const url = this.webhookUrl()
    if (url) {
      try {
        await this.send(url, { text: input.body ? `${input.title}\n${input.body}` : input.title, kind: input.kind, title: input.title, body: input.body ?? null, link: input.link ?? null })
      }
      catch (error) {
        log.warn(`[postline] the alert webhook did not take "${input.title}": ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return true
  }

  async list(options: { limit?: number } = {}): Promise<{ alerts: AlertView[], unread: number }> {
    const limit = Math.min(100, Math.max(1, Math.floor(Number(options.limit) || 30)))
    const rows = await database.selectFrom('alerts').selectAll().orderBy('id', 'desc').limit(limit).execute()
    const unreadRows = await database.selectFrom('alerts').select(['id']).where('read_at', 'is', null).execute()
    return {
      unread: unreadRows.length,
      alerts: rows.map((row: any): AlertView => ({
        id: Number(row.id),
        kind: row.kind,
        title: String(row.title),
        body: row.body || null,
        link: row.link || null,
        at: row.created_at ? `${String(row.created_at).replace(' ', 'T')}Z` : null,
        read: Boolean(row.read_at),
      })),
    }
  }

  /** Mark one alert read, or all of them when no id is given. */
  async markRead(id?: number | null): Promise<void> {
    let query = database.updateTable('alerts').set({ read_at: stamp(), updated_at: stamp() }).where('read_at', 'is', null)
    if (id) query = query.where('id', '=', id)
    await query.execute()
  }
}

export const alerts = new AlertService()
