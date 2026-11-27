import type { RecurrenceInterval, RecurringSegment } from '../Support/Social/recurring-posts'
import type { PublishTarget } from '../Support/Social/targets'
import type { SocialProvider } from '../Support/Social/types'
import { db } from '@stacksjs/database'
import { log } from '@stacksjs/logging'
import { UserFacingError } from '../Support/Http/user-error'
import { nextRecurringAt, RECURRENCE_INTERVALS } from '../Support/Social/recurring-posts'
import { parseStoredContent, referencedMediaFiles } from '../Support/Social/stored-content'
import { instantFromWallTime, isRealTimestamp, isValidTimeZone } from '../Support/time'
import { crosspostProviders } from './Social/CrosspostService'
import { copyRecurringSegments, LATE_GRACE_MINUTES, postQueue, removeRecurringMedia } from './Social/QueueService'
import { ensureAccount, now, uuid } from './Social/support'
import { workspace } from './WorkspaceService'

const database = db as any
const uuidPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i

interface RecurringTarget {
  provider: SocialProvider
  account: { uuid?: string, handle: string } | null
}

interface RecurringTemplate {
  segments: RecurringSegment[]
  targets: RecurringTarget[]
}

interface RecurringRow {
  id: number
  uuid: string
  account_id: number
  title: string
  template: string
  interval: RecurrenceInterval
  starts_at: string
  next_at: string
  timezone: string
  active: number
  last_error: string | null
}

export interface RecurringPost {
  uuid: string
  title: string
  targets: Array<{ provider: SocialProvider, handle: string | null }>
  interval: RecurrenceInterval
  startsAt: string
  nextAt: string
  timezone: string
  active: boolean
  lastError: string | null
}

export interface ArchivedRecurringPost extends Omit<RecurringPost, 'targets' | 'lastError'> {
  template: RecurringTemplate
}

function intervalOf(value: unknown): RecurrenceInterval {
  const interval = RECURRENCE_INTERVALS.find(interval => interval === value)
  if (!interval) throw new UserFacingError('Choose a daily, weekly, or monthly repeat.')
  return interval
}

function startTime(value: unknown, timezone: string): string {
  const local = String(value ?? '').replace('T', ' ')
  const instant = instantFromWallTime(local.length === 16 ? local + ':00' : local, timezone)
  if (!instant) throw new UserFacingError('Choose a date and time that exists in the workspace time zone.')
  const timestamp = instant.toISOString().slice(0, 19).replace('T', ' ')
  if (timestamp <= now()) throw new UserFacingError('Choose a repeat time in the future.')
  return timestamp
}

function view(row: RecurringRow): RecurringPost {
  const { targets }: RecurringTemplate = JSON.parse(row.template)
  return {
    uuid: row.uuid,
    title: row.title,
    targets: targets.map(target => ({ provider: target.provider, handle: target.account?.handle ?? null })),
    interval: row.interval,
    startsAt: row.starts_at,
    nextAt: row.next_at,
    timezone: row.timezone,
    active: Boolean(row.active),
    lastError: row.last_error,
  }
}

export function readArchivedRecurringPost(value: unknown): ArchivedRecurringPost {
  const invalid = () => new UserFacingError('That export contains an invalid recurring post.')
  if (!value || typeof value !== 'object') throw invalid()
  const { uuid, title, interval, startsAt, nextAt, timezone, active, template } = value as ArchivedRecurringPost
  if (typeof uuid !== 'string' || !uuidPattern.test(uuid) || typeof title !== 'string' || !title.trim() || title.length > 160
    || !isValidTimeZone(timezone) || typeof startsAt !== 'string' || startsAt.length !== 19 || !isRealTimestamp(startsAt)
    || typeof nextAt !== 'string' || nextAt.length !== 19 || !isRealTimestamp(nextAt) || nextAt < startsAt
    || typeof active !== 'boolean' || !Array.isArray(template?.segments) || !template.segments.length
    || !Array.isArray(template.targets) || !template.targets.length)
    throw invalid()
  const segments = template.segments.map((segment) => {
    if (!segment || typeof segment.title !== 'string' || typeof segment.body !== 'string' || !segment.body.trim()
      || (segment.content !== null && (typeof segment.content !== 'string' || !parseStoredContent(segment.content))))
      throw invalid()
    referencedMediaFiles(segment.content)
    return { title: segment.title, body: segment.body, content: segment.content }
  })
  const providers = crosspostProviders()
  const targets = template.targets.map((target) => {
    if (!target || !providers.includes(target.provider)
      || (target.account !== null && (target.provider === 'blog' || typeof target.account?.handle !== 'string' || !target.account.handle.trim())))
      throw invalid()
    return { provider: target.provider, account: target.account && { handle: target.account.handle } }
  })
  return { uuid, title, interval: intervalOf(interval), startsAt, nextAt, timezone, active, template: { segments, targets } }
}

export class RecurringPostService {
  private async row(accountId: number, key: unknown): Promise<RecurringRow> {
    const row = typeof key === 'string' && uuidPattern.test(key)
      ? await database.selectFrom('recurring_posts').selectAll().where('account_id', '=', accountId).where('uuid', '=', key).executeTakeFirst()
      : null
    if (!row) throw new UserFacingError('That recurring post is no longer in the Queue.')
    return row
  }

  async list() {
    const accountId = await ensureAccount()
    const rows: RecurringRow[] = await database.selectFrom('recurring_posts').selectAll()
      .where('account_id', '=', accountId).orderBy('next_at', 'asc').execute()
    return { rules: rows.map(view), timezone: await workspace.timezone() }
  }

  async create(input: { id: unknown, interval: unknown, startAt: unknown, withoutImages?: boolean }): Promise<RecurringPost> {
    const id = Number(input.id)
    if (!Number.isSafeInteger(id) || id <= 0) throw new UserFacingError('Choose a post to repeat.')
    const interval = intervalOf(input.interval)
    const timezone = await workspace.timezone()
    const startsAt = startTime(input.startAt, timezone)
    const accountId = await ensureAccount()
    const { segments, targets } = await postQueue.repeatSource(id, accountId)
    const addresses: RecurringTarget[] = []
    for (const target of targets) {
      const row = target.identityId ? await database.selectFrom('social_identities').select(['uuid', 'handle'])
        .where('id', '=', target.identityId).where('provider', '=', target.provider).executeTakeFirst() : null
      if (target.identityId && !row?.handle) throw new UserFacingError('Reconnect the account before setting up a repeat.')
      addresses.push({ provider: target.provider, account: row ? { uuid: row.uuid, handle: row.handle } : null })
    }
    const key = uuid()
    return copyRecurringSegments(segments, targets.map(target => target.provider), input.withoutImages === true, async (copies) => {
      const row = await database.insertInto('recurring_posts').values({
        uuid: key, account_id: accountId, title: segments[0]!.title.trim().slice(0, 160) || 'Recurring post',
        template: JSON.stringify({ segments: copies, targets: addresses }), interval,
        starts_at: startsAt, next_at: startsAt, timezone, active: 1, created_at: now(), updated_at: now(),
      }).returningAll().executeTakeFirstOrThrow()
      return view(row)
    })
  }

  async change(key: unknown, action: unknown, input: { interval?: unknown, startAt?: unknown } = {}): Promise<RecurringPost | null> {
    const rule = await this.row(await ensureAccount(), key)
    if (action === 'remove') {
      await database.deleteFrom('recurring_posts').where('id', '=', rule.id).execute()
      await removeRecurringMedia((JSON.parse(rule.template) as RecurringTemplate).segments)
      return null
    }

    const clock = now()
    const template: RecurringTemplate = JSON.parse(rule.template)
    let values: Record<string, unknown>
    if (action === 'pause') values = { active: 0 }
    else if (action === 'resume') {
      await this.resolveTargets(template.targets)
      values = {
        active: 1, last_error: null,
        next_at: rule.next_at > clock ? rule.next_at : this.next(rule, clock),
      }
    }
    else if (action === 'reschedule') {
      const startsAt = startTime(input.startAt, rule.timezone)
      values = { starts_at: startsAt, next_at: startsAt, interval: intervalOf(input.interval) }
    }
    else throw new UserFacingError('Choose a recurring post action.')

    const changed = await database.updateTable('recurring_posts').set({ ...values, updated_at: clock })
      .where('id', '=', rule.id).where('next_at', '=', rule.next_at).where('active', '=', rule.active)
      .where('interval', '=', rule.interval).where('starts_at', '=', rule.starts_at)
      .returningAll().executeTakeFirst()
    if (!changed) throw new UserFacingError('This recurring post changed. Refresh the Queue and try again.')
    return view(changed)
  }

  private next(rule: RecurringRow, after: string): string {
    return nextRecurringAt({ startsAt: rule.starts_at, timezone: rule.timezone, interval: rule.interval }, after)
  }

  private async resolveTargets(addresses: RecurringTarget[]): Promise<PublishTarget[]> {
    return await Promise.all(addresses.map(async ({ provider, account }) => {
      if (!account) return { provider, identityId: null }
      const key = account.uuid ? 'uuid' : 'handle'
      const row = await database.selectFrom('social_identities').select('id').where('provider', '=', provider)
        .where(key, '=', account.uuid ?? account.handle).where('auth_status', '!=', 'revoked').executeTakeFirst()
      if (!row) throw new UserFacingError(`Reconnect ${account.handle} before this post can repeat.`)
      return { provider, identityId: Number(row.id) }
    }))
  }

  async queueDue(clock = now(), graceMinutes = LATE_GRACE_MINUTES): Promise<{ queued: number, skipped: number, paused: number }> {
    const report = { queued: 0, skipped: 0, paused: 0 }
    if ((await workspace.profile()).publishingPaused) return report
    const rows: RecurringRow[] = await database.selectFrom('recurring_posts').selectAll()
      .where('active', '=', 1).where('next_at', '<=', clock).orderBy('next_at', 'asc').execute()
    // nextRecurringAt is exclusive. Start just before the grace boundary
    // so an occurrence exactly on the boundary is eligible too.
    const beforeGrace = new Date(Date.parse(clock.replace(' ', 'T') + 'Z') - graceMinutes * 60_000 - 1000).toISOString().slice(0, 19).replace('T', ' ')
    for (const rule of rows) {
      try {
        const nextAt = this.next(rule, clock)
        const dueAt = rule.next_at > beforeGrace ? rule.next_at : this.next(rule, beforeGrace)
        if (dueAt > clock) {
          if (await this.claim(rule, nextAt, clock)) report.skipped++
          continue
        }
        const { segments, targets }: RecurringTemplate = JSON.parse(rule.template)
        const destinations = await this.resolveTargets(targets)
        const queued = await copyRecurringSegments(segments, destinations.map(target => target.provider), false, copies =>
          this.claim(rule, nextAt, clock, tx => postQueue.writeRecurringOccurrence(tx, rule.account_id, rule.timezone, dueAt, copies, destinations)))
        if (queued) report.queued++
      }
      catch (error) {
        log.warn(`[postline] recurring post ${rule.uuid}: ${error instanceof Error ? error.message : String(error)}`)
        // A database or filesystem error can clear on the next scheduler tick.
        // A missing attachment or account needs the owner's intervention.
        if (!(error instanceof UserFacingError)) continue
        const changed = await database.updateTable('recurring_posts').set({ active: 0, last_error: error.message.slice(0, 300), updated_at: clock })
          .where('id', '=', rule.id).where('next_at', '=', rule.next_at).where('active', '=', 1)
          .where('interval', '=', rule.interval).where('starts_at', '=', rule.starts_at).returning('id').executeTakeFirst()
        if (changed) report.paused++
      }
    }
    return report
  }

  /** Advancing the schedule and writing its occurrence are one SQLite transaction. */
  private async claim(rule: RecurringRow, nextAt: string, clock: string, write?: (tx: typeof database) => void): Promise<true | null> {
    return await database.transaction((tx: typeof database) => {
      const account = tx.selectFrom('accounts').select('publishing_paused').where('id', '=', rule.account_id).executeTakeFirst()
      if (!account || Number(account.publishing_paused)) return null
      const changed = tx.updateTable('recurring_posts').set({ next_at: nextAt, last_error: null, updated_at: clock })
        .where('id', '=', rule.id).where('active', '=', 1).where('next_at', '=', rule.next_at)
        .where('interval', '=', rule.interval).where('starts_at', '=', rule.starts_at).returning('id').executeTakeFirst()
      if (!changed) return null
      write?.(tx)
      return true as const
    })
  }

  export(accountId: number, tx: typeof database): ArchivedRecurringPost[] {
    const rows: RecurringRow[] = tx.selectFrom('recurring_posts').selectAll()
      .where('account_id', '=', accountId).orderBy('id', 'asc').execute()
    return rows.map(row => {
      const { targets: _targets, lastError: _lastError, ...settings } = view(row)
      return { ...settings, template: JSON.parse(row.template) }
    })
  }

  async restore(accountId: number, archive: ArchivedRecurringPost): Promise<boolean> {
    const clock = now()
    const nextAt = archive.nextAt > clock ? archive.nextAt : nextRecurringAt(archive, clock)
    const destinations = await this.resolveTargets(archive.template.targets).catch(() => null)
    return await database.transaction((tx: typeof database) => {
      if (tx.selectFrom('recurring_posts').select('id').where('account_id', '=', accountId).where('uuid', '=', archive.uuid).executeTakeFirst())
        return false
      tx.insertInto('recurring_posts').values({
        uuid: archive.uuid, account_id: accountId, title: archive.title, template: JSON.stringify(archive.template),
        starts_at: archive.startsAt, next_at: nextAt, interval: archive.interval, timezone: archive.timezone,
        active: Number(archive.active && Boolean(destinations)),
        last_error: archive.active && !destinations ? 'Reconnect the original accounts before resuming this repeat.' : null,
        created_at: clock, updated_at: clock,
      }).execute()
      return true
    })
  }
}

export const recurringPosts = new RecurringPostService()
