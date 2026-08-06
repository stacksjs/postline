import { describe, expect, test } from 'bun:test'
import { normalizeKeywords, normalizeListeningProviders } from '../../app/Services/KeywordMonitoringService'

describe('keyword monitoring helpers', () => {
  test('normalizes and deduplicates comma-separated keywords', () => {
    expect(normalizeKeywords(' The Open Times, stacks.js, The Open Times, x ')).toEqual(['The Open Times', 'stacks.js'])
  })

  test('accepts JSON and array keyword payloads', () => {
    expect(normalizeKeywords('["The Open Times", "Campaign Builder"]')).toEqual(['The Open Times', 'Campaign Builder'])
    expect(normalizeKeywords(['mentions', 'launch week'])).toEqual(['mentions', 'launch week'])
  })

  test('only keeps supported listening providers', () => {
    expect(normalizeListeningProviders(['bluesky', 'TWITTER', 'instagram', 'mastodon', 'bluesky']))
      .toEqual(['bluesky', 'twitter', 'mastodon'])
  })
})
