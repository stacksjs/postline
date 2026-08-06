/**
 * The publication's readers.
 *
 * Free and paid subscribers are one table because they are one relationship:
 * a reader who upgrades is the same person with the same address and the same
 * history, not a new row. `plan` says which they are, and every read that
 * cares filters on it.
 *
 * Subscribing is double opt-in. A new address lands as `pending` and is never
 * mailed a post until it confirms, so an address typed by somebody else does
 * not turn into mail that reader did not ask for.
 */

import { db } from '@stacksjs/database'
import { discover } from './DiscoverService'
import { publications } from './PublicationService'
import { now, uuid } from './Social/support'

const database = db as any

export interface SubscriberView {
  id: number
  email: string
  name: string | null
  status: string
  plan: string
  tierId: number | null
  currentPeriodEnd: string | null
  cancelsAt: string | null
  confirmedAt: string | null
  source: string
  sourceEntryId: number | null
  createdAt: string | null
}

export interface SubscriberStats {
  total: number
  active: number
  pending: number
  paid: number
  unsubscribed: number
  /** Monthly recurring revenue in minor units, annual tiers amortised. */
  mrrCents: number
}

/**
 * Normalise an address for storage and comparison.
 *
 * Lowercased only. Stripping dots or plus-tags would silently merge addresses
 * that some providers treat as distinct, which would mean one reader
 * unsubscribing another.
 */
export function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

/** Deliberately permissive: the confirmation mail is the real validation. */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function token(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

export function subscriberRow(row: any): SubscriberView {
  return {
    id: Number(row.id),
    email: String(row.email),
    name: row.name || null,
    status: String(row.status || 'pending'),
    plan: String(row.plan || 'free'),
    tierId: row.publication_tier_id ? Number(row.publication_tier_id) : null,
    currentPeriodEnd: row.current_period_end || null,
    cancelsAt: row.cancels_at || null,
    confirmedAt: row.confirmed_at || null,
    source: String(row.source || 'site'),
    sourceEntryId: row.source_entry_id ? Number(row.source_entry_id) : null,
    createdAt: row.created_at || null,
  }
}

export class SubscriberService {
  /**
   * Add a reader, or return the one already there.
   *
   * Never reports whether an address was already subscribed: that would turn
   * the public subscribe form into a way to test whether somebody reads a
   * publication. Re-subscribing an unsubscribed address is allowed and resets
   * it to pending, so leaving is not permanent.
   */
  async subscribe(input: {
    email: unknown
    name?: unknown
    source?: unknown
    sourceEntryId?: unknown
    /**
     * Whether to mail the confirmation link. Checkout passes false: paying is
     * a stronger opt-in than clicking a link, and asking somebody to confirm a
     * subscription they just bought reads as a failed payment.
     */
    sendConfirmation?: boolean
  }): Promise<{ subscriber: SubscriberView, created: boolean, confirmationToken: string | null }> {
    const email = normalizeEmail(input.email)
    if (!isEmail(email)) throw new Error('Enter a valid email address.')

    const publication = await publications.ensurePublication()
    const existing = await database
      .selectFrom('publication_subscribers')
      .selectAll()
      .where('publication_id', '=', publication.id)
      .where('email', '=', email)
      .executeTakeFirst()

    if (existing) {
      if (existing.status !== 'unsubscribed')
        return { subscriber: subscriberRow(existing), created: false, confirmationToken: null }

      const confirmation = token()
      await database.updateTable('publication_subscribers').set({
        status: 'pending',
        confirmation_token: confirmation,
        updated_at: now(),
      }).where('id', '=', existing.id).execute()

      await this.mailConfirmation(input.sendConfirmation, email, confirmation)

      return {
        subscriber: subscriberRow(await this.findById(existing.id)),
        created: false,
        confirmationToken: confirmation,
      }
    }

    const confirmation = token()
    const subscriberUuid = uuid()
    const sourceEntryId = Number(input.sourceEntryId) || null

    await database.insertInto('publication_subscribers').values({
      uuid: subscriberUuid,
      email,
      name: String(input.name || '').trim().slice(0, 120) || null,
      status: 'pending',
      plan: 'free',
      stripe_customer_id: null,
      stripe_subscription_id: null,
      current_period_end: null,
      cancels_at: null,
      confirmation_token: confirmation,
      unsubscribe_token: token(),
      confirmed_at: null,
      source: sourceEntryId ? 'discover' : (String(input.source || 'site') as string),
      source_entry_id: sourceEntryId,
      publication_id: publication.id,
      created_at: now(),
      updated_at: now(),
    }).execute()

    const created = await database
      .selectFrom('publication_subscribers')
      .selectAll()
      .where('uuid', '=', subscriberUuid)
      .executeTakeFirstOrThrow()

    await this.mailConfirmation(input.sendConfirmation, email, confirmation)

    return { subscriber: subscriberRow(created), created: true, confirmationToken: confirmation }
  }

  /**
   * Confirm a double opt-in.
   *
   * Credits the Discover entry that won the reader, but only here rather than
   * at subscribe time: an unconfirmed address is not yet a subscriber, and
   * ranking on unconfirmed signups would make the feed gameable by anyone with
   * a form and a list of addresses.
   */
  async confirm(confirmationToken: string): Promise<SubscriberView> {
    const value = String(confirmationToken || '').trim()
    if (!value) throw new Error('That confirmation link is not valid.')

    const subscriber = await database
      .selectFrom('publication_subscribers')
      .selectAll()
      .where('confirmation_token', '=', value)
      .executeTakeFirst()

    if (!subscriber) throw new Error('That confirmation link is not valid or has already been used.')

    await database.updateTable('publication_subscribers').set({
      status: 'active',
      confirmed_at: now(),
      // Burn the token: a confirmation link should work exactly once.
      confirmation_token: null,
      updated_at: now(),
    }).where('id', '=', subscriber.id).execute()

    if (subscriber.source_entry_id) {
      try {
        await discover.recordConversion(Number(subscriber.source_entry_id))
      }
      catch {
        // Attribution is a ranking nicety. Losing it must never cost the
        // reader their confirmation.
      }
    }

    await this.refreshSubscriberCount()

    return subscriberRow(await this.findById(Number(subscriber.id)))
  }

  /** One-click unsubscribe from a mail footer, no login involved. */
  async unsubscribe(unsubscribeToken: string): Promise<{ email: string }> {
    const value = String(unsubscribeToken || '').trim()
    const subscriber = value
      ? await database
          .selectFrom('publication_subscribers')
          .selectAll()
          .where('unsubscribe_token', '=', value)
          .executeTakeFirst()
      : null

    if (!subscriber) throw new Error('That unsubscribe link is not valid.')

    await database.updateTable('publication_subscribers').set({
      status: 'unsubscribed',
      updated_at: now(),
    }).where('id', '=', subscriber.id).execute()

    await this.refreshSubscriberCount()

    return { email: String(subscriber.email) }
  }

  async list(options: { status?: string, plan?: string, limit?: number } = {}) {
    const publication = await publications.ensurePublication()
    let query = database
      .selectFrom('publication_subscribers')
      .selectAll()
      .where('publication_id', '=', publication.id)

    if (options.status) query = query.where('status', '=', options.status)
    if (options.plan) query = query.where('plan', '=', options.plan)

    const rows = await query
      .orderBy('created_at', 'desc')
      .limit(Math.min(Math.max(Number(options.limit) || 200, 1), 500))
      .execute()

    return rows.map(subscriberRow)
  }

  /**
   * Headline numbers for the dashboard.
   *
   * MRR amortises annual tiers to a month rather than counting them whole, so
   * the number does not jump every time an annual subscriber renews.
   */
  async stats(): Promise<SubscriberStats> {
    const publication = await publications.ensurePublication()
    const rows = await database
      .selectFrom('publication_subscribers')
      .selectAll()
      .where('publication_id', '=', publication.id)
      .execute()

    const tiers = await database.selectFrom('publication_tiers').selectAll().execute()
    const tierById = new Map(tiers.map((tier: any) => [Number(tier.id), tier]))

    let mrrCents = 0
    for (const row of rows) {
      if (row.status !== 'active' || row.plan !== 'paid') continue
      const tier: any = tierById.get(Number(row.publication_tier_id))
      if (!tier) continue
      const amount = Number(tier.amount_cents || 0)
      mrrCents += tier.interval === 'year' ? Math.round(amount / 12) : amount
    }

    return {
      total: rows.length,
      active: rows.filter((row: any) => row.status === 'active').length,
      pending: rows.filter((row: any) => row.status === 'pending').length,
      paid: rows.filter((row: any) => row.status === 'active' && row.plan === 'paid').length,
      unsubscribed: rows.filter((row: any) => row.status === 'unsubscribed').length,
      mrrCents,
    }
  }

  /** Everyone who should receive a send, optionally paid-only. */
  async recipients(audience: 'everyone' | 'paid'): Promise<SubscriberView[]> {
    const publication = await publications.ensurePublication()
    let query = database
      .selectFrom('publication_subscribers')
      .selectAll()
      .where('publication_id', '=', publication.id)
      .where('status', '=', 'active')

    if (audience === 'paid') query = query.where('plan', '=', 'paid')

    return (await query.execute()).map(subscriberRow)
  }

  /**
   * Deliver the confirmation link.
   *
   * Never throws. The subscriber row is already committed by the time this
   * runs, so a mail transport that is down or unconfigured must not turn a
   * successful signup into an error the reader sees. The token stays on the
   * row, so a resend is possible without a second signup.
   */
  private async mailConfirmation(wanted: boolean | undefined, email: string, token: string): Promise<void> {
    if (wanted === false) return

    try {
      const publication = await publications.ensurePublication()
      const { sendPublicationConfirmation } = await import('../Mail/PublicationConfirmation')
      await sendPublicationConfirmation({ to: email, publicationName: publication.name, confirmationToken: token })
    }
    catch (error) {
      console.warn(`[postline] subscriber saved but confirmation mail failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async findById(id: number) {
    return await database
      .selectFrom('publication_subscribers')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow()
  }

  async findByEmail(email: string) {
    const publication = await publications.ensurePublication()
    return await database
      .selectFrom('publication_subscribers')
      .selectAll()
      .where('publication_id', '=', publication.id)
      .where('email', '=', normalizeEmail(email))
      .executeTakeFirst()
  }

  /**
   * Keep the publication's denormalized count in step.
   *
   * Recomputed rather than incremented, for the same reason the entry counter
   * is: an increment that runs twice or not at all drifts silently, and this
   * number decides Discover ranking.
   */
  async refreshSubscriberCount(): Promise<void> {
    const publication = await publications.ensurePublication()
    const active = await database
      .selectFrom('publication_subscribers')
      .select(['id'])
      .where('publication_id', '=', publication.id)
      .where('status', '=', 'active')
      .execute()

    await database.updateTable('publications')
      .set({ subscriber_count: active.length, updated_at: now() })
      .where('id', '=', publication.id)
      .execute()
  }
}

export const subscribers = new SubscriberService()
