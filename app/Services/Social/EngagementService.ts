import { publicMessage } from '../../Support/Http/action-error'
import { bluesky } from './BlueskyService'
import { instagram } from './InstagramService'
import { linkedin } from './LinkedInService'
import { threads } from './ThreadsService'
import { mastodon } from './MastodonService'

export async function syncEngagement() {
  const sources: Array<{ provider: string, result: Promise<{ synced: number, errors?: string[] }> }> = [
    { provider: 'bluesky', result: bluesky.syncMetrics() },
    { provider: 'mastodon', result: mastodon.syncMetrics() },
    { provider: 'linkedin', result: linkedin.syncMetrics() },
    { provider: 'instagram', result: instagram.syncMetrics() },
    { provider: 'threads', result: threads.syncMetrics() },
  ]
  const settled = await Promise.allSettled(sources.map(source => source.result))
  let synced = 0
  const errors: Array<{ provider: string, explanation: string }> = []

  for (const [index, result] of settled.entries()) {
    const provider = sources[index]!.provider
    if (result.status === 'fulfilled') {
      synced += result.value.synced
      for (const explanation of result.value.errors ?? []) errors.push({ provider, explanation })
    }
    else {
      errors.push({ provider, explanation: publicMessage(result.reason, 'Postline could not refresh engagement metrics.') })
    }
  }
  return { synced, errors }
}
