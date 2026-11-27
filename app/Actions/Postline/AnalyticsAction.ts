import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { db } from '@stacksjs/database'
import { response } from '@stacksjs/router'
import { workspace } from '../../Services/WorkspaceService'
import { actionFailure } from '../../Support/Http/action-error'
import { readEngagementMetrics, summarizeEngagement } from '../../Support/Social/engagement-analytics'

const database = db as any

const DAY_MS = 24 * 60 * 60 * 1000
const PAGE_SIZE = 25

interface PublishedPost { id: number, published_at: string }

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

  async handle(request: RequestInstance) {
    const days = Number(request.get('days') ?? 30)
    const pageParameter = request.get('page')
    const requestedPage = Number(pageParameter ?? 1)
    if (![7, 30, 90].includes(days) || !Number.isSafeInteger(requestedPage) || requestedPage < 1)
      return response.json({ ok: false, error: 'Choose a 7-, 30- or 90-day range and a valid page.' }, { status: 422 })

    try {
      const now = Date.now()
      const since = new Date(now - (days - 1) * DAY_MS)
      const sinceKey = `${dayKey(since)} 00:00:00`
      const untilKey = new Date(now).toISOString().slice(0, 19).replace('T', ' ')

      const posts = await database
        .selectFrom('posts')
        .select(['id', 'published_at'])
        .where('status', '=', 'published')
        .where('published_at', '>=', sinceKey)
        .where('published_at', '<=', untilKey)
        .orderBy('published_at', 'desc')
        .orderBy('id', 'desc')
        .execute() as PublishedPost[]

      // Use the same set of posts for the chart, channel mix and engagement.
      // Target creation time still gives the hour each destination was sent.
      const targets = await database
        .selectFrom('post_targets')
        .innerJoin('posts', 'posts.id', '=', 'post_targets.post_id')
        .leftJoin('social_identities', 'social_identities.id', '=', 'post_targets.social_identity_id')
        .select(['post_targets.id', 'post_targets.post_id', 'post_targets.provider', 'post_targets.created_at', 'post_targets.metrics', 'social_identities.handle'])
        .where('post_targets.status', '=', 'published')
        .where('posts.status', '=', 'published')
        .where('posts.published_at', '>=', sinceKey)
        .where('posts.published_at', '<=', untilKey)
        .execute() as Array<{ id: number, post_id: number, provider: string, created_at: string, metrics: string | null, handle: string | null }>

      // Fill each UTC calendar day, so a gap stays visible as zero.
      const byDay = new Map<string, number>()
      for (const post of posts) {
        const date = parseUtc(post.published_at)
        if (date) byDay.set(dayKey(date), (byDay.get(dayKey(date)) || 0) + 1)
      }
      const series: Array<{ label: string, value: number }> = []
      for (let offset = days - 1; offset >= 0; offset--) {
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

      const pageCount = Math.ceil(posts.length / PAGE_SIZE)
      const page = Math.min(requestedPage, Math.max(1, pageCount))
      const first = (page - 1) * PAGE_SIZE
      const pagePosts = pageParameter == null ? [] : posts.slice(first, first + PAGE_SIZE)
      const pageIds = pagePosts.map(post => post.id)
      const postContent = pageIds.length
        ? await database.selectFrom('posts').select(['id', 'title', 'body']).where('id', 'in', pageIds).execute() as Array<{ id: number, title: string | null, body: string }>
        : []
      const titles = new Map(postContent.map(post => [post.id, (post.title?.trim() || post.body.trim()).slice(0, 160)]))
      const postTargets = new Map(pageIds.map(id => [id, [] as Array<{ id: number, provider: string, handle: string | null, counts: ReturnType<typeof readEngagementMetrics> }>]))
      for (const target of targets)
        postTargets.get(target.post_id)?.push({ id: target.id, provider: target.provider, handle: target.handle, counts: readEngagementMetrics(target.metrics) })

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
          totalPosts: posts.length,
          ...(pageParameter == null ? {} : {
            posts: pagePosts.map(post => ({
              id: post.id,
              publishedAt: post.published_at,
              title: titles.get(post.id) || 'Untitled post',
              targets: postTargets.get(post.id) ?? [],
            })),
            page,
            pageCount,
          }),
          channelMix,
          windows,
          timezone,
        },
      }, { headers: { 'Cache-Control': 'private, no-store' } })
    }
    catch (error) {
      return actionFailure(error, 500)
    }
  },
})
