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

function readMetrics(value: string | null) {
  if (!value) return null
  try {
    const { likes, reposts, replies } = JSON.parse(value)
    if ([likes, reposts, replies].every(count => Number.isSafeInteger(count) && count >= 0))
      return { likes: Number(likes), reposts: Number(reposts), replies: Number(replies) }
  }
  catch {
    // Older or damaged snapshots cannot be counted as zero engagement.
  }
  return null
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
  const byHour = new Map<number, Sample>()
  const postsByHour = new Map<number, number>()
  const engagement = { likes: 0, reposts: 0, replies: 0, syncedTargets: 0 }

  for (const target of targets) {
    const sentAt = new Date(`${String(target.created_at).replace(' ', 'T')}Z`)
    const hour = Number.isNaN(sentAt.getTime()) ? null : hourInZone(sentAt, timezone)
    if (hour !== null) postsByHour.set(hour, (postsByHour.get(hour) ?? 0) + 1)

    const metrics = readMetrics(target.metrics)
    if (!metrics) continue
    engagement.likes += metrics.likes
    engagement.reposts += metrics.reposts
    engagement.replies += metrics.replies
    engagement.syncedTargets++

    const interactions = metrics.likes + metrics.reposts + metrics.replies
    record(byProvider, target.provider, interactions)
    if (hour !== null) record(byHour, hour, interactions)
  }

  const [channel, otherChannel] = rank(byProvider)
  const [firstWindow, otherWindow] = rank(byHour)

  return {
    engagement,
    providers: [...byProvider.keys()],
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
