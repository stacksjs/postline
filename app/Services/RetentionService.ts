import type { SocialProvider } from '../Support/Social/types'
import type { PurgeResult, PurgeScope } from './Social/PurgeService'
import { db } from '@stacksjs/database'
import { PURGEABLE_PROVIDERS, postPurge } from './Social/PurgeService'
import { ensureAccount, now } from './Social/support'

const database = db as any

/**
 * Automatic deletion of old posts: "delete everything older than N days".
 *
 * The settings live on the workspace's `accounts` row (see app/Models/Account.ts)
 * and the daily AutoDeletePosts job applies them through PurgeService, so a
 * scheduled run gets the same caps, rate-limit pacing, unsupported-network
 * handling and `purge_runs` audit trail as one started by hand.
 *
 * The manual purge asks for a typed phrase on every run. A schedule cannot,
 * so the consent is taken once instead: turning this on requires an explicit
 * acknowledgement, and the age limit is mandatory, so a schedule can never be
 * a full wipe.
 */

export const MIN_RETENTION_DAYS = 1
export const MAX_RETENTION_DAYS = 3650

/**
 * What "every network" means for a schedule: the social networks, not the
 * publication itself. Expiring old articles from your own paper is a choice
 * someone has to make by ticking it, never a default.
 */
export const DEFAULT_RETENTION_PROVIDERS: SocialProvider[] = PURGEABLE_PROVIDERS.filter(provider => provider !== 'opentimes')

export interface RetentionSettings {
  enabled: boolean
  days: number
  /** Empty means DEFAULT_RETENTION_PROVIDERS. */
  providers: SocialProvider[]
  scope: PurgeScope
}

export interface RetentionLastRun {
  at: string
  matched: number
  deleted: number
  failed: number
  status: string
}

export interface SaveRetentionInput {
  enabled?: boolean
  days?: number
  providers?: SocialProvider[]
  scope?: string
  /** Required to switch automatic deletion on; ignored otherwise. */
  acknowledged?: boolean
}

export type RetentionRunResult =
  | { ran: false, reason: string }
  | { ran: true, settings: RetentionSettings, result: PurgeResult }

function parseProviders(value: unknown): SocialProvider[] {
  let list: unknown = value
  if (typeof value === 'string') {
    try {
      list = JSON.parse(value)
    }
    catch {
      list = value.split(',')
    }
  }
  if (!Array.isArray(list)) return []
  return [...new Set(list.map(item => String(item).trim()).filter(Boolean))] as SocialProvider[]
}

export function normalizeDays(value: unknown): number {
  const days = Math.floor(Number(value))
  if (!Number.isFinite(days) || days < MIN_RETENTION_DAYS || days > MAX_RETENTION_DAYS)
    throw new Error(`Keep posts for between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS} days.`)
  return days
}

/** Settings as stored, read back defensively: a bad row means "off". */
export function settingsFromRow(row: Record<string, unknown> | undefined): RetentionSettings {
  let days = 7
  try {
    days = normalizeDays(row?.auto_delete_days ?? 7)
  }
  catch {}

  return {
    enabled: row?.auto_delete_enabled === true || Number(row?.auto_delete_enabled) === 1,
    days,
    providers: parseProviders(row?.auto_delete_providers).filter(provider => PURGEABLE_PROVIDERS.includes(provider)),
    scope: row?.auto_delete_scope === 'tracked' ? 'tracked' : 'all',
  }
}

/**
 * Validate a save against what is stored, returning what to write. Throws
 * before anything is persisted; switching automatic deletion on is the one
 * change that needs `acknowledged`.
 */
export function resolveRetentionSave(input: SaveRetentionInput, current: RetentionSettings): RetentionSettings {
  const enabled = input.enabled ?? current.enabled
  const days = input.days === undefined ? current.days : normalizeDays(input.days)
  const providers = input.providers === undefined ? current.providers : parseProviders(input.providers)
  const scope: PurgeScope = input.scope === undefined ? current.scope : input.scope === 'tracked' ? 'tracked' : 'all'

  const unsupported = providers.filter(provider => !PURGEABLE_PROVIDERS.includes(provider))
  if (unsupported.length)
    throw new Error(`These networks cannot delete posts through their API: ${unsupported.join(', ')}.`)

  if (enabled && !current.enabled && input.acknowledged !== true)
    throw new Error('Confirm that posts will be permanently deleted before turning automatic deletion on.')

  return { enabled, days, providers, scope }
}

export class RetentionService {
  async get(): Promise<RetentionSettings> {
    const accountId = await ensureAccount()
    const row = await database
      .selectFrom('accounts')
      .select(['auto_delete_enabled', 'auto_delete_days', 'auto_delete_providers', 'auto_delete_scope'])
      .where('id', '=', accountId)
      .executeTakeFirst()
    return settingsFromRow(row)
  }

  async save(input: SaveRetentionInput): Promise<RetentionSettings> {
    const { enabled, days, providers, scope } = resolveRetentionSave(input, await this.get())

    const accountId = await ensureAccount()
    await database.updateTable('accounts').set({
      auto_delete_enabled: enabled ? 1 : 0,
      auto_delete_days: days,
      auto_delete_providers: JSON.stringify(providers),
      auto_delete_scope: scope,
      updated_at: now(),
    }).where('id', '=', accountId).execute()

    return { enabled, days, providers, scope }
  }

  /** The most recent scheduled run, from the purge audit log. */
  async lastRun(): Promise<RetentionLastRun | null> {
    const rows = await database
      .selectFrom('purge_runs')
      .select(['finished_at', 'created_at', 'status', 'matched_count', 'deleted_count', 'failed_count', 'details'])
      .where('mode', '=', 'execute')
      .orderBy('id', 'desc')
      .limit(50)
      .execute() as any[]

    const scheduled = rows.filter((row) => {
      try {
        return JSON.parse(String(row.details || '{}')).trigger === 'schedule'
      }
      catch {
        return false
      }
    })
    if (!scheduled.length) return null

    // One run writes a row per network, all finishing within the same pass.
    const at = String(scheduled[0].finished_at || scheduled[0].created_at)
    const sameRun = scheduled.filter(row => String(row.finished_at || row.created_at).slice(0, 13) === at.slice(0, 13))
    return {
      at,
      matched: sameRun.reduce((total, row) => total + Number(row.matched_count || 0), 0),
      deleted: sameRun.reduce((total, row) => total + Number(row.deleted_count || 0), 0),
      failed: sameRun.reduce((total, row) => total + Number(row.failed_count || 0), 0),
      status: sameRun.some(row => row.status === 'failed' || row.status === 'partial') ? 'partial' : 'completed',
    }
  }

  /** What the daily job calls. A no-op unless the owner turned it on. */
  async run(): Promise<RetentionRunResult> {
    const settings = await this.get()
    if (!settings.enabled) return { ran: false, reason: 'Automatic deletion is off.' }

    const result = await postPurge.purgeOlderThan({
      olderThanDays: settings.days,
      scope: settings.scope,
      providers: settings.providers.length ? settings.providers : DEFAULT_RETENTION_PROVIDERS,
    })
    return { ran: true, settings, result }
  }
}

export const retention = new RetentionService()
