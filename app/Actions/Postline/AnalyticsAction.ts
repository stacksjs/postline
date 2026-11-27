import { Action } from '@stacksjs/actions'
import { db } from '@stacksjs/database'
import { response } from '@stacksjs/router'
import { workspace } from '../../Services/WorkspaceService'
import { actionFailure } from '../../Support/Http/action-error'
import { summarizeEngagement } from '../../Support/Social/engagement-analytics'

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
      const now = Date.now()
      const since = new Date(now - 29 * DAY_MS)
      const sinceKey = `${dayKey(since)} 00:00:00`
      const untilKey = new Date(now).toISOString().slice(0, 19).replace('T', ' ')

      const posts = await database
        .selectFrom('posts')
        .select(['id', 'published_at'])
        .where('status', '=', 'published')
        .where('published_at', '>=', sinceKey)
        .where('published_at', '<=', untilKey)
        .execute()

      // The same thirty days as the chart: channel mix, posting windows and
      // engagement are for what went out in that window. It read every
      // target ever published (#105).
      const targets = await database
        .selectFrom('post_targets')
        .select(['post_id', 'provider', 'status', 'created_at', 'metrics'])
        .where('status', '=', 'published')
        .where('created_at', '>=', sinceKey)
        .where('created_at', '<=', untilKey)
        .execute()

      // Posts published per day over the last 30 days (gaps filled with 0).
      const byDay = new Map<string, number>()
      for (const post of posts) {
        const date = parseUtc(post.published_at)
        if (date) byDay.set(dayKey(date), (byDay.get(dayKey(date)) || 0) + 1)
      }
      const series: Array<{ label: string, value: number }> = []
      for (let offset = 29; offset >= 0; offset--) {
        const date = new Date(now - offset * DAY_MS)
        series.push({
          label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
          value: byDay.get(dayKey(date)) || 0,
        })
      }

      const weekAgo = now - 7 * DAY_MS
      const twoWeeksAgo = now - 14 * DAY_MS
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

      const timezone = await workspace.timezone()
      const { engagement, providers, countsByProvider, minSample, bestChannel, bestHour, windows } = summarizeEngagement(targets, timezone)

      return response.json({
        ok: true,
        data: {
          stats: {
            postsThisWeek,
            postsLastWeek,
            bestChannel,
            bestHour,
            engagement: { ...engagement, providers, countsByProvider },
            minSample,
          },
          series,
          channelMix,
          windows,
          timezone,
        },
      })
    }
    catch (error) {
      return actionFailure(error, 500)
    }
  },
})
