import { hourInZone } from '../time'

const MIN_SAMPLE = 3

interface PublishedTarget {
  post_id: number
  provider: string
  created_at: string
  metrics: string | null
}

interface Sample {
  count: number
  interactions: number
}

const metricFields = ['likes', 'reposts', 'replies', 'quotes', 'views', 'shares', 'reach', 'saves'] as const
type MetricField = typeof metricFields[number]
export type EngagementCounts = Partial<Record<MetricField, number>>

function readMetrics(value: string | null): EngagementCounts {
  if (!value) return {}
  try {
    const counts = JSON.parse(value) as Partial<Record<MetricField, unknown>> | null
    return Object.fromEntries(metricFields.flatMap((field) => {
      const count = counts?.[field]
      return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? [[field, count]] : []
    }))
  }
  catch {
    // A damaged snapshot has no usable measurements.
    return {}
  }
}

function record<Key>(groups: Map<Key, Map<number, Sample>>, key: Key, postId: number, interactions: number): void {
  const posts = groups.get(key) ?? new Map<number, Sample>()
  const previous = posts.get(postId) ?? { count: 0, interactions: 0 }
  posts.set(postId, { count: previous.count + 1, interactions: previous.interactions + interactions })
  groups.set(key, posts)
}

function rank<Key>(groups: Map<Key, Map<number, Sample>>) {
  return [...groups].filter(([, posts]) => posts.size >= MIN_SAMPLE)
    .map(([key, posts]) => {
      const sum = [...posts.values()].reduce((total, post) => total + post.interactions / post.count, 0)
      return { key, count: posts.size, average: sum / posts.size }
    })
    .sort((a, b) => b.average - a.average || b.count - a.count)
}

export function summarizeEngagement(targets: readonly PublishedTarget[], timezone: string) {
  const byProvider = new Map<string, Map<number, Sample>>()
  const countsByProvider = new Map<string, EngagementCounts & { measured: number }>()
  const byHour = new Map<number, Map<number, Sample>>()
  const postsByHour = new Map<number, Set<number>>()
  const totalFields = ['likes', 'reposts', 'replies'] as const
  const engagement = { likes: 0, reposts: 0, replies: 0, syncedTargets: 0 }

  for (const target of targets) {
    const sentAt = new Date(`${String(target.created_at).replace(' ', 'T')}Z`)
    const hour = Number.isNaN(sentAt.getTime()) ? null : hourInZone(sentAt, timezone)
    if (hour !== null) {
      const posts = postsByHour.get(hour) ?? new Set<number>()
      posts.add(target.post_id)
      postsByHour.set(hour, posts)
    }

    const metrics = readMetrics(target.metrics)
    if (!Object.keys(metrics).length) continue
    engagement.syncedTargets++
    const providerCounts = countsByProvider.get(target.provider) ?? { measured: 0 }
    providerCounts.measured++
    for (const field of metricFields) {
      const count = metrics[field]
      if (count === undefined) continue
      providerCounts[field] = (providerCounts[field] ?? 0) + count
    }
    countsByProvider.set(target.provider, providerCounts)
    for (const field of totalFields) engagement[field] += metrics[field] ?? 0

    // Likes (or reactions) and replies are comparable across networks.
    // Reposts are displayed above but cannot influence a cross-network rank.
    if (metrics.likes === undefined || metrics.replies === undefined) continue
    const interactions = metrics.likes + metrics.replies
    record(byProvider, target.provider, target.post_id, interactions)
    if (hour !== null) record(byHour, hour, target.post_id, interactions)
  }

  const [channel, otherChannel] = rank(byProvider)
  const [firstWindow, otherWindow] = rank(byHour)

  return {
    engagement,
    providers: [...countsByProvider.keys()],
    countsByProvider: [...countsByProvider].map(([provider, counts]) => ({ provider, ...counts })),
    minSample: MIN_SAMPLE,
    bestChannel: channel && otherChannel && channel.average > otherChannel.average
      ? { provider: channel.key, count: channel.count, average: channel.average }
      : null,
    bestHour: firstWindow && otherWindow && firstWindow.average > otherWindow.average
      ? { hour: firstWindow.key, count: firstWindow.count, average: firstWindow.average }
      : null,
    windows: [...postsByHour].map(([hour, posts]) => ({ hour, count: posts.size })).sort((a, b) => b.count - a.count || a.hour - b.hour).slice(0, 3),
  }
}
