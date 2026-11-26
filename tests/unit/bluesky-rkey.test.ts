/**
 * Bluesky record keys and searches (#132).
 */
import { describe, expect, test } from 'bun:test'
import { blueskyQueries } from '../../app/Services/KeywordMonitoringService'
import { blueskyRecordKey, isTid } from '../../app/Support/Social/bluesky-rkey'

const ALPHABET = '234567abcdefghijklmnopqrstuvwxyz'
function decodeMicros(key: string): bigint {
  let value = 0n
  for (const char of key) value = (value << 5n) | BigInt(ALPHABET.indexOf(char))
  return value >> 10n
}

describe('a post\'s record key', () => {
  test('is a TID, the same on every attempt', () => {
    const key = blueskyRecordKey(42, 7)
    expect(isTid(key)).toBe(true)
    expect(blueskyRecordKey(42, 7)).toBe(key)
  })

  test('differs for another post or another account', () => {
    expect(blueskyRecordKey(43, 7)).not.toBe(blueskyRecordKey(42, 7))
    expect(blueskyRecordKey(42, 8)).not.toBe(blueskyRecordKey(42, 7))
  })

  test('is never in the future', () => {
    const micros = decodeMicros(blueskyRecordKey(5_000_000, 1))
    expect(micros < BigInt(Date.now()) * 1000n).toBe(true)
  })
})

describe('a Listening rule on Bluesky', () => {
  test('"any" is one search per keyword, since Bluesky has no OR', () => {
    expect(blueskyQueries(['postline', 'open times'], 'any')).toEqual(['postline', '"open times"'])
  })

  test('"all" and a phrase are one search each', () => {
    expect(blueskyQueries(['postline', 'launch'], 'all')).toEqual(['postline launch'])
    expect(blueskyQueries(['postline', 'launch'], 'phrase')).toEqual(['"postline launch"'])
  })
})
