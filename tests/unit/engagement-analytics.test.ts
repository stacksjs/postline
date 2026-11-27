import { describe, expect, test } from 'bun:test'
import { summarizeEngagement } from '../../app/Support/Social/engagement-analytics'

function target(provider: string, utcHour: string, likes: number | null) {
  return {
    post_id: 0,
    provider,
    created_at: `2026-11-26 ${utcHour}:00:00`,
    metrics: likes === null ? null : JSON.stringify({ likes, reposts: 0, replies: 0 }),
  }
}

function individualPosts(targets: ReturnType<typeof target>[]) {
  return targets.map((target, index) => ({ ...target, post_id: index + 1 }))
}

describe('engagement recommendations', () => {
  test('uses interactions per measured post and the workspace time zone', () => {
    const older = target('bluesky', '03', 4)
    const newer = target('mastodon', '16', 6)
    const result = summarizeEngagement(individualPosts([
      older, older, older, older, older,
      newer, newer, newer,
      target('bluesky', '03', null),
    ]), 'America/Los_Angeles')

    expect(result.engagement).toEqual({ likes: 38, reposts: 0, replies: 0, syncedTargets: 8 })
    expect(result.bestChannel).toEqual({ provider: 'mastodon', count: 3, average: 6 })
    expect(result.bestHour).toEqual({ hour: 8, count: 3, average: 6 })
    expect(result.windows[0]).toEqual({ hour: 19, count: 6 })
  })

  test('requires enough measured posts in two groups and withholds a tied recommendation', () => {
    const first = target('bluesky', '03', 40)
    const second = target('mastodon', '16', 40)
    const broken = { ...second, metrics: '{}' }
    const tooFew = summarizeEngagement(individualPosts([first, first, first, second, second, broken]), 'UTC')
    const tied = summarizeEngagement(individualPosts([first, first, first, second, second, second]), 'UTC')

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

    const result = summarizeEngagement(individualPosts([bluesky, bluesky, bluesky, instagram, instagram, instagram, threads, threads, threads]), 'UTC')

    expect(result.countsByProvider).toEqual([
      { provider: 'bluesky', measured: 3, likes: 12, replies: 0, reposts: 210 },
      { provider: 'instagram', measured: 3, likes: 15, replies: 6 },
      { provider: 'threads', measured: 3, reposts: 3 },
    ])
    expect(result.bestChannel).toEqual({ provider: 'instagram', count: 3, average: 7 })
    expect(result.bestHour).toEqual({ hour: 16, count: 3, average: 7 })
  })


  test('keeps views-only measurements and counts unique posts for the minimum sample', () => {
    const targets = [1, 2].flatMap(post_id => ['bluesky', 'instagram', 'threads'].map(provider => ({
      ...target(provider, post_id === 1 ? '04' : '23', post_id * 4),
      post_id,
    })))
    targets.push({ ...target('linkedin', '10', null), post_id: 3, metrics: JSON.stringify({ views: 45 }) })

    const result = summarizeEngagement(targets, 'UTC')

    expect(result.bestChannel).toBeNull()
    expect(result.bestHour).toBeNull()
    expect(result.windows.every(window => window.count === 1)).toBe(true)
    expect(result.countsByProvider.find(counts => counts.provider === 'linkedin')).toEqual({ provider: 'linkedin', measured: 1, views: 45 })
  })

})
