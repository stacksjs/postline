import { describe, expect, test } from 'bun:test'
import { normalizeProviders, scheduleFromOffset } from '../../app/Services/CampaignService'

describe('campaign planning helpers', () => {
  test('normalizes, deduplicates, and filters campaign providers', () => {
    expect(normalizeProviders(['Bluesky', 'linkedin', 'bluesky', 'myspace']))
      .toEqual(['bluesky', 'linkedin'])
  })

  test('accepts comma-separated campaign providers', () => {
    expect(normalizeProviders('threads, blog, threads'))
      .toEqual(['threads', 'blog'])
  })

  test('schedules a post by its campaign-day offset', () => {
    expect(scheduleFromOffset('2026-08-10', 7, '13:45'))
      .toBe('2026-08-17 13:45:00')
  })

  test('falls back to a safe time when generated input is malformed', () => {
    expect(scheduleFromOffset('2026-08-10', 2, 'tomorrow'))
      .toBe('2026-08-12 09:00:00')
  })
})
