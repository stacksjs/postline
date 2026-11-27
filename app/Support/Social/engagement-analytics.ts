import { hourInZone } from '../time'

const MIN_SAMPLE = 3

interface PublishedTarget {
  provider: string
  created_at: string
  metrics: string | null
}

interface Sample {
  count: number
  interactions: number
}

const metricFields = ['likes', 'reposts', 'replies'] as const
type MetricField = typeof metricFields[number]
type Counts = Partial<Record<MetricField, number>>

function readMetrics(value: string | null): Counts {
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

function record<Key>(samples: Map<Key, Sample>, key: Key, interactions: number): void {
  const previous = samples.get(key) ?? { count: 0, interactions: 0 }
  samples.set(key, { count: previous.count + 1, interactions: previous.interactions + interactions })
}

function rank<Key>(samples: Map<Key, Sample>) {
  return [...samples].filter(([, sample]) => sample.count >= MIN_SAMPLE)
    .map(([key, sample]) => ({ key, count: sample.count, average: sample.interactions / sample.count }))
    .sort((a, b) => b.average - a.average || b.count - a.count)
}

export function summarizeEngagement(targets: readonly PublishedTarget[], timezone: string) {
  const byProvider = new Map<string, Sample>()
  const countsByProvider = new Map<string, Counts & { measured: number }>()
  const byHour = new Map<number, Sample>()
  const postsByHour = new Map<number, number>()
  const engagement = { likes: 0, reposts: 0, replies: 0, syncedTargets: 0 }

  for (const target of targets) {
    const sentAt = new Date(`${String(target.created_at).replace(' ', 'T')}Z`)
    const hour = Number.isNaN(sentAt.getTime()) ? null : hourInZone(sentAt, timezone)
    if (hour !== null) postsByHour.set(hour, (postsByHour.get(hour) ?? 0) + 1)

    const metrics = readMetrics(target.metrics)
    if (!Object.keys(metrics).length) continue
    engagement.syncedTargets++
    const providerCounts = countsByProvider.get(target.provider) ?? { measured: 0 }
    providerCounts.measured++
    for (const field of metricFields) {
      const count = metrics[field]
      if (count === undefined) continue
      engagement[field] += count
      providerCounts[field] = (providerCounts[field] ?? 0) + count
    }
    countsByProvider.set(target.provider, providerCounts)

    // Likes (or reactions) and replies are comparable across networks.
    // Reposts are displayed above but cannot influence a cross-network rank.
    if (metrics.likes === undefined || metrics.replies === undefined) continue
    const interactions = metrics.likes + metrics.replies
    record(byProvider, target.provider, interactions)
    if (hour !== null) record(byHour, hour, interactions)
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
    windows: [...postsByHour].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 3).map(([hour, count]) => ({ hour, count })),
  }
}
