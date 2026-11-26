/**
 * The record key a Bluesky post is created under, the same on every attempt
 * (#132).
 *
 * A publish that times out may have landed. Sent again under a new key it
 * would post twice; sent under the same key, the server refuses the copy and
 * the driver reads back the record that is already there. So the key is
 * worked out from what identifies the attempt, the post and the account,
 * rather than chosen at random.
 *
 * It is a TID, the form Bluesky expects for a post's key: 13 characters of
 * sortable base32 over 64 bits, a zero bit, 53 bits of microseconds and 10
 * bits of clock id. The microseconds are a fixed point in 2024 plus the post
 * id, and the clock id comes from the account id: stable, distinct for each
 * post and account, and never in the future.
 */
const ALPHABET = '234567abcdefghijklmnopqrstuvwxyz'
const BASE_MICROS = 1_704_067_200_000_000n // 2024-01-01T00:00:00Z

export function blueskyRecordKey(postId: number, identityId: number): string {
  const micros = BASE_MICROS + BigInt(Math.max(0, Math.floor(postId))) * 1_000n
  const clock = BigInt(Math.max(0, Math.floor(identityId)) % 1024)
  let value = (micros << 10n) | clock
  let key = ''
  for (let index = 0; index < 13; index++) {
    key = ALPHABET[Number(value & 31n)] + key
    value >>= 5n
  }
  return key
}

/** Whether `key` has the shape of a TID. */
export function isTid(key: string): boolean {
  return /^[234567a-j][234567a-z]{12}$/.test(key)
}
