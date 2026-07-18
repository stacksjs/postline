import { Action } from '@stacksjs/actions'
import { db } from '@stacksjs/database'
import { response } from '@stacksjs/router'

const database = db as any

const DAY_MS = 24 * 60 * 60 * 1000

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function parseUtc(value: string): Date | null {
  const date = new Date(`${String(value).replace(' ', 'T')}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

export default new Action({
  name: 'Postline Analytics',
  description: 'Publishing analytics computed from real posts and targets.',
  method: 'GET',

  async handle() {
    try {
      const since = new Date(Date.now() - 30 * DAY_MS)
      const sinceKey = `${dayKey(since)} 00:00:00`

      const posts = await database
        .selectFrom('posts')
        .select(['id', 'published_at'])
        .where('status', '=', 'published')
        .where('published_at', '>=', sinceKey)
        .execute()

      const targets = await database
        .selectFrom('post_targets')
        .select(['provider', 'status', 'updated_at'])
        .where('status', '=', 'published')
        .execute()

      // Posts published per day over the last 30 days (gaps filled with 0).
      const byDay = new Map<string, number>()
      for (const post of posts) {
        const date = parseUtc(post.published_at)
        if (date) byDay.set(dayKey(date), (byDay.get(dayKey(date)) || 0) + 1)
      }
      const series: Array<{ label: string, value: number }> = []
      for (let offset = 29; offset >= 0; offset--) {
        const date = new Date(Date.now() - offset * DAY_MS)
        series.push({
          label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
          value: byDay.get(dayKey(date)) || 0,
        })
      }

      const weekAgo = Date.now() - 7 * DAY_MS
      const twoWeeksAgo = Date.now() - 14 * DAY_MS
      let postsThisWeek = 0
      let postsLastWeek = 0
      for (const post of posts) {
        const time = parseUtc(post.published_at)?.getTime()
        if (!time) continue
        if (time >= weekAgo) postsThisWeek += 1
        else if (time >= twoWeeksAgo) postsLastWeek += 1
      }

      // Channel mix across all published targets.
      const byProvider = new Map<string, number>()
      for (const target of targets)
        byProvider.set(target.provider, (byProvider.get(target.provider) || 0) + 1)
      const totalTargets = targets.length
      const channelMix = [...byProvider.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([provider, count]) => ({
          provider,
          published: count,
          share: totalTargets ? Math.round((count / totalTargets) * 100) : 0,
        }))

      // Publish-hour histogram (UTC) → best posting windows.
      const byHour = new Map<number, number>()
      for (const target of targets) {
        const date = parseUtc(target.updated_at)
        if (date) byHour.set(date.getUTCHours(), (byHour.get(date.getUTCHours()) || 0) + 1)
      }
      const windows = [...byHour.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([hour, count]) => ({ hour, count }))

      return response.json({
        ok: true,
        data: {
          stats: {
            postsThisWeek,
            postsLastWeek,
            bestChannel: channelMix[0] || null,
            bestHour: windows[0] || null,
          },
          series,
          channelMix,
          windows,
        },
      })
    }
    catch (error) {
      return response.json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, { status: 500 })
    }
  },
})
