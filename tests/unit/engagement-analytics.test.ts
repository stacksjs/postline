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

  test('displays reported counts and compares only likes and replies', () => {
    const bluesky = { ...target('bluesky', '03', 4), metrics: JSON.stringify({ likes: 4, replies: 0, reposts: 70 }) }
    const instagram = { ...target('instagram', '16', 5), metrics: JSON.stringify({ likes: 5, replies: 2 }) }
    const threads = { ...target('threads', '12', 0), metrics: JSON.stringify({ reposts: 1 }) }

    const result = summarizeEngagement([bluesky, bluesky, bluesky, instagram, instagram, instagram, threads, threads, threads], 'UTC')

    expect(result.countsByProvider).toEqual([
      { provider: 'bluesky', measured: 3, likes: 12, replies: 0, reposts: 210 },
      { provider: 'instagram', measured: 3, likes: 15, replies: 6 },
      { provider: 'threads', measured: 3, reposts: 3 },
    ])
    expect(result.bestChannel).toEqual({ provider: 'instagram', count: 3, average: 7 })
    expect(result.bestHour).toEqual({ hour: 16, count: 3, average: 7 })
  })

})
