import { describe, expect, test } from 'bun:test'
import { summarizeEngagement } from '../../app/Support/Social/engagement-analytics'

function target(provider: string, utcHour: string, likes: number | null) {
  return {
    provider,
    created_at: `2026-11-26 ${utcHour}:00:00`,
    metrics: likes === null ? null : JSON.stringify({ likes, reposts: 0, replies: 0 }),
  }
}

describe('engagement recommendations', () => {
  test('uses interactions per measured post and the workspace time zone', () => {
    const older = target('bluesky', '03', 4)
    const newer = target('mastodon', '16', 6)
    const result = summarizeEngagement([
      older, older, older, older, older,
      newer, newer, newer,
      target('bluesky', '03', null),
    ], 'America/Los_Angeles')

    expect(result.engagement).toEqual({ likes: 38, reposts: 0, replies: 0, syncedTargets: 8 })
    expect(result.bestChannel).toEqual({ provider: 'mastodon', count: 3, average: 6 })
    expect(result.bestHour).toEqual({ hour: 8, count: 3, average: 6 })
    expect(result.windows[0]).toEqual({ hour: 19, count: 6 })
  })

  test('requires enough measured posts in two groups and withholds a tied recommendation', () => {
    const first = target('bluesky', '03', 40)
    const second = target('mastodon', '16', 40)
    const broken = { ...second, metrics: '{}' }
    const tooFew = summarizeEngagement([first, first, first, second, second, broken], 'UTC')
    const tied = summarizeEngagement([first, first, first, second, second, second], 'UTC')

    expect(tooFew.engagement.syncedTargets).toBe(5)
    expect(tooFew.bestChannel).toBeNull()
    expect(tooFew.bestHour).toBeNull()
    expect(tied.bestChannel).toBeNull()
    expect(tied.bestHour).toBeNull()
  })
})
