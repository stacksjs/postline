import { db } from '@stacksjs/database'
import { UserFacingError } from '../../Support/Http/user-error'

const MICROS_PER_DOLLAR = 1_000_000
const DEFAULT_DAILY_LIMIT = 2 * MICROS_PER_DOLLAR

// https://docs.x.com/x-api/getting-started/pricing
export const TWITTER_READ_PRICE = { post: 5_000, user: 10_000, directMessage: 10_000 } as const

function dailyLimit(): number {
  const value = Bun.env.TWITTER_DAILY_READ_BUDGET_USD?.trim()
  if (!value) return DEFAULT_DAILY_LIMIT
  const micros = Math.round(Number(value) * MICROS_PER_DOLLAR)
  return /^\d+(?:\.\d{1,6})?$/.test(value) && Number.isSafeInteger(micros) ? micros : 0
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function twitterReadUsage() {
  const day = utcDay()
  const rows = await db.unsafe(
    'SELECT estimated_micros FROM twitter_read_usage WHERE day = ?',
    [day],
  )
  return {
    day,
    estimatedUsd: Number(rows[0]?.estimated_micros ?? 0) / MICROS_PER_DOLLAR,
    limitUsd: dailyLimit() / MICROS_PER_DOLLAR,
  }
}

/**
 * Reserve the most this request can cost before it leaves the workspace.
 * The single SQLite statement lets web requests and scheduled jobs share a
 * cap. A failed or interrupted request keeps its reservation for the day,
 * since X could have served the data even if the response was lost.
 */
export async function withTwitterReadBudget<T>(
  maximumMicros: number,
  request: () => Promise<{ value: T, estimatedMicros: number }>,
): Promise<T> {
  const day = utcDay()
  const limit = dailyLimit()
  const budgetError = new UserFacingError(
    'This X API read would exceed the workspace’s daily read budget. The budget resets at midnight UTC.',
    'twitter_read_budget',
  )
  if (maximumMicros > limit) throw budgetError
  const rows = await db.unsafe(`
    INSERT INTO twitter_read_usage (day, estimated_micros) VALUES (?, ?)
    ON CONFLICT(day) DO UPDATE
      SET estimated_micros = twitter_read_usage.estimated_micros + excluded.estimated_micros
      WHERE twitter_read_usage.estimated_micros + excluded.estimated_micros <= ?
    RETURNING estimated_micros
  `, [day, maximumMicros, limit])
  if (!rows.length) throw budgetError

  const { value, estimatedMicros } = await request()
  const refund = maximumMicros - estimatedMicros
  if (refund > 0) {
    await db.unsafe('UPDATE twitter_read_usage SET estimated_micros = estimated_micros - ? WHERE day = ?', [refund, day])
  }
  return value
}
