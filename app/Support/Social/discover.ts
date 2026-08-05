/**
 * Discover's shared vocabulary and its ranking.
 *
 * Kept out of the service so the ranking is a pure function that can be read,
 * argued with and tested without a database. It is the part of Discover most
 * likely to need tuning, and the part where a bug is least visible.
 */

/** The two feeds. */
export const DISCOVER_FORMS = ['short', 'long'] as const

export type DiscoverForm = typeof DISCOVER_FORMS[number]

export function isDiscoverForm(value: unknown): value is DiscoverForm {
  return DISCOVER_FORMS.includes(String(value) as DiscoverForm)
}

/** Signals that feed the rank of one entry. */
export interface RankInputs {
  /** Subscribers of the publication that posted it. */
  subscriberCount: number
  /** Reads on the entry itself. */
  readCount: number
  /** Subscriptions the entry is credited with winning. */
  conversionCount: number
  /** Recommendations pointing at the publication. */
  recommendationCount: number
  /** Age of the entry in hours. */
  ageHours: number
}

/**
 * How much each signal is worth.
 *
 * Conversions dominate on purpose. A post that turns a reader into a
 * subscriber is the only signal here that cannot be produced by being loud,
 * which is the difference the marketing page promises between ranking by
 * readers and ranking by spend.
 */
const WEIGHTS = {
  conversion: 12,
  recommendation: 6,
  read: 0.35,
  /**
   * Sublinear, and deliberately small.
   *
   * Size is a tiebreaker, not a driver. At weight 4 a publication with 40,000
   * subscribers and no engagement at all outranked one carrying three
   * recommendations, which is the exact outcome this ranking exists to avoid.
   * At 1.5 the log curve still separates a large publication from a tiny one
   * without letting audience size alone beat evidence that people are reading.
   */
  subscriberLog: 1.5,
} as const

/**
 * Half-life of an entry's score, in hours.
 *
 * Three days. Long enough that a weekly essay is still findable on the
 * following weekend, short enough that the feed is not the same ten posts for
 * a month.
 */
const HALF_LIFE_HOURS = 72

/**
 * Rank one entry.
 *
 * Engagement is summed, then decayed by age. Decay is multiplicative rather
 * than subtractive so a high-scoring old post falls behind a fresh one of
 * similar quality instead of holding the top slot forever, and so the score
 * can never go negative and sort below a brand new entry with nothing on it.
 */
export function rankEntry(inputs: RankInputs): number {
  const engagement
    = inputs.conversionCount * WEIGHTS.conversion
      + inputs.recommendationCount * WEIGHTS.recommendation
      + inputs.readCount * WEIGHTS.read
      // log1p, not log: a publication with zero subscribers must contribute
      // zero here rather than negative infinity.
      + Math.log1p(Math.max(0, inputs.subscriberCount)) * WEIGHTS.subscriberLog

  const decay = 0.5 ** (Math.max(0, inputs.ageHours) / HALF_LIFE_HOURS)

  return Math.max(0, Math.round(engagement * decay))
}

/** Hours between a timestamp and now, floored at zero for future dates. */
export function ageInHours(publishedAt: string | null | undefined, from: number = Date.now()): number {
  const value = String(publishedAt || '')
  const parsed = Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
  if (Number.isNaN(parsed)) return 0

  return Math.max(0, (from - parsed) / 3_600_000)
}

/**
 * The excerpt shown in the feed.
 *
 * Cut on a word boundary rather than mid-word, and only ellipsised when
 * something was actually removed, so a short post does not get a trailing
 * ellipsis implying there is more to read.
 */
export function excerptOf(body: string, limit = 280): string {
  const text = String(body || '').replace(/\s+/g, ' ').trim()
  if (text.length <= limit) return text

  const cut = text.slice(0, limit)
  const lastSpace = cut.lastIndexOf(' ')

  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}
