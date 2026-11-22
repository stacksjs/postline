/**
 * LinkedIn's API version and its post text format.
 *
 * LinkedIn publishes a version every month and retires each one a year
 * later; a retired `LinkedIn-Version` header is answered with an error, so
 * every LinkedIn call fails at once. The version is therefore one constant
 * with a test (`tests/unit/linkedin-text.test.ts`) that fails two months
 * before it is retired, while there is still time to move.
 */
export const LINKEDIN_API_VERSION = '202611'

/** When LinkedIn retires a `YYYYMM` version: a year on, mid-month. */
export function linkedInVersionSunset(version: string): Date {
  const year = Number(version.slice(0, 4))
  const month = Number(version.slice(4, 6))
  return new Date(Date.UTC(year + 1, month - 1, 15))
}

/**
 * The version to send. An override from the environment is honoured unless
 * LinkedIn has already retired it: a stale line left in `.env` would
 * otherwise break every LinkedIn call with no hint as to why.
 */
export function resolveLinkedInVersion(override: unknown, nowMs: number = Date.now()): string {
  const wanted = String(override ?? '').trim()
  if (!/^\d{6}$/.test(wanted)) return LINKEDIN_API_VERSION
  return linkedInVersionSunset(wanted).getTime() > nowMs ? wanted : LINKEDIN_API_VERSION
}

/**
 * Post text in LinkedIn's "little" format.
 *
 * Every reserved character has to be escaped with a backslash or the post is
 * rejected or mangled. A hashtag is the exception: `#word` is itself an
 * element of the format, so escaping its `#` turned every hashtag into plain
 * text. A `#` that does not start a word (as in "issue # 4") is still escaped.
 */
export function linkedInCommentary(text: string): string {
  return text.replace(/[\\|{}@[\]()<>#*_~]/g, (char, offset: number) => {
    if (char === '#' && startsHashtag(text, offset)) return char
    return `\\${char}`
  })
}

function startsHashtag(text: string, offset: number): boolean {
  const before = offset === 0 ? '' : text[offset - 1]!
  if (before && /[\p{L}\p{N}_#&/]/u.test(before)) return false
  const word = /^[\p{L}\p{N}_]+/u.exec(text.slice(offset + 1))?.[0]
  // A tag needs a letter: "#1" is a number, not a hashtag.
  return Boolean(word && /\p{L}/u.test(word))
}
