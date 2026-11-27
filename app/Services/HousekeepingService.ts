/**
 * Trim what Postline keeps locally so a long-running install stops growing (#116).
 *
 * These are copies and logs, not the owner's posts: the networks hold the
 * mentions, the timeline and the messages, and Postline's copies are for
 * reading them in one place. Each kind is kept for a fixed time, chosen so
 * nothing anyone would look back for is gone too soon, and the nightly
 * PruneLocalData job removes what is older. Posts, their targets and their
 * numbers are never touched here; deleting posts is RetentionService's job.
 */
import { config } from '@stacksjs/config'
import { db } from '@stacksjs/database'
import { readHeartbeats, withHeartbeat } from '../Support/heartbeat'
import { WEBHOOK_KEEP_DAYS } from './PostWebhookService'

const database = db as any

/** Days each kind of local copy is kept. */
export const KEEP_DAYS = {
  /** Keyword matches from Listening: a search result, read the week it arrives. */
  keywordMentions: 90,
  publicInbox: 90,
  /** The home-feed cache behind Timeline, refetched on every visit. */
  timelineItems: 30,
  /** The log of cleanup runs. The last 24 hours also count toward Threads' daily cap. */
  purgeRuns: 180,
  /** Alerts already read; unread ones are kept until they are read. */
  readAlerts: 90,
  /** Direct messages. Their conversations stay, and the networks keep the full history. */
  directMessages: 365,
} as const

/** How often the SQLite file is compacted (#215): deleted rows leave free pages behind, since auto_vacuum is off. */
export const VACUUM_EVERY_DAYS = 30
export const VACUUM_JOB = 'VacuumDatabase'

export interface PruneResult {
  keywordMentions: number
  publicInbox: number
  timelineItems: number
  purgeRuns: number
  readAlerts: number
  directMessages: number
  webhookDeliveries: number
}

/** A UTC `YYYY-MM-DD HH:MM:SS` stamp `days` ago, the format the tables store. */
export function daysAgo(days: number, nowMs: number = Date.now()): string {
  return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
}

async function deleteOlder(table: string, column: string, days: number, extra?: (query: any) => any): Promise<number> {
  let query = database.deleteFrom(table).where(column, '<', daysAgo(days))
  if (extra) query = extra(query)
  const result = await query.executeTakeFirst()
  return Number(result?.numDeletedRows ?? result?.changes ?? 0)
}

export class HousekeepingService {
  async prune(): Promise<PruneResult> {
    return {
      publicInbox: await deleteOlder('inbox_mentions', 'posted_at', KEEP_DAYS.publicInbox),
      keywordMentions: await deleteOlder('keyword_mentions', 'created_at', KEEP_DAYS.keywordMentions),
      timelineItems: await deleteOlder('timeline_items', 'created_at', KEEP_DAYS.timelineItems),
      purgeRuns: await deleteOlder('purge_runs', 'created_at', KEEP_DAYS.purgeRuns),
      readAlerts: await deleteOlder('alerts', 'read_at', KEEP_DAYS.readAlerts, query => query.where('read_at', 'is not', null)),
      directMessages: await deleteOlder('dm_messages', 'created_at', KEEP_DAYS.directMessages),
      webhookDeliveries: await deleteOlder('post_webhook_deliveries', 'created_at', WEBHOOK_KEEP_DAYS),
    }
  }

  /**
   * Compact the SQLite file once a month (#215). Pruning frees pages inside
   * the file but never returns them, so it only grows. VACUUM rewrites it; it
   * needs the file to itself for a moment, and waits out other writers like
   * any statement does. A failed attempt is recorded and tried again the next
   * day, since only a successful run counts.
   */
  async vacuumIfDue(nowMs: number = Date.now()): Promise<'vacuumed' | 'not-due' | 'not-sqlite'> {
    if (String(config.database?.default || 'sqlite') !== 'sqlite') return 'not-sqlite'
    const last = (await readHeartbeats()).find(beat => beat.job === VACUUM_JOB)
    const lastOk = last?.lastStatus === 'ok' && last.lastFinishedAt ? Date.parse(last.lastFinishedAt) : 0
    if (lastOk && nowMs - lastOk < VACUUM_EVERY_DAYS * 24 * 60 * 60 * 1000) return 'not-due'
    await withHeartbeat(VACUUM_JOB, async () => await database.unsafe('VACUUM').execute())
    return 'vacuumed'
  }
}

export const housekeeping = new HousekeepingService()
