/**
 * Paid subscriptions.
 *
 * Money moves from the reader to the publication owner's own Stripe account.
 * There is no Postline account in the middle, which is the whole product
 * claim, and also why this uses the Stripe client from `@stacksjs/payments`
 * directly rather than the package's user-centric helpers: those bill an app's
 * `UserModel`, and a reader is not one.
 *
 * The webhook is the source of truth for subscription state, not the redirect
 * back from checkout. A reader who closes the tab after paying is still a
 * paying reader, and a redirect that never fires must not cost them access.
 */

import { db } from '@stacksjs/database'
import { env } from '@stacksjs/env'
import { stripe } from '@stacksjs/payments'
import { publications } from './PublicationService'
import { now, uuid } from './Social/support'
import { subscribers } from './SubscriberService'

const database = db as any

export interface TierInput {
  id?: unknown
  name?: unknown
  description?: unknown
  amountCents?: unknown
  currency?: unknown
  interval?: unknown
  active?: unknown
}

export interface TierView {
  id: number
  name: string
  description: string | null
  amountCents: number
  currency: string
  interval: string
  stripePriceId: string | null
  active: boolean
  sortOrder: number
  /** Whether this tier can actually be checked out. */
  ready: boolean
}

export function tierRow(row: any): TierView {
  return {
    id: Number(row.id),
    name: String(row.name),
    description: row.description || null,
    amountCents: Number(row.amount_cents || 0),
    currency: String(row.currency || 'usd'),
    interval: String(row.interval || 'month'),
    stripePriceId: row.stripe_price_id || null,
    active: Boolean(Number(row.active || 0)),
    sortOrder: Number(row.sort_order || 0),
    ready: Boolean(row.stripe_price_id),
  }
}

/** Whether Stripe is configured at all, so the UI can say so plainly. */
export function billingConfigured(): boolean {
  return Boolean(String(env.STRIPE_SECRET_KEY || '').trim())
}

function sqliteFromUnix(seconds: unknown): string | null {
  const value = Number(seconds)
  if (!value || Number.isNaN(value)) return null

  return new Date(value * 1000).toISOString().slice(0, 19).replace('T', ' ')
}

export class BillingService {
  async listTiers(): Promise<TierView[]> {
    const publication = await publications.ensurePublication()
    const rows = await database
      .selectFrom('publication_tiers')
      .selectAll()
      .where('publication_id', '=', publication.id)
      .orderBy('sort_order', 'asc')
      .orderBy('amount_cents', 'asc')
      .execute()

    return rows.map(tierRow)
  }

  /** The tiers a reader may actually subscribe to. */
  async publicTiers(): Promise<TierView[]> {
    return (await this.listTiers()).filter(tier => tier.active && tier.ready)
  }

  /**
   * Create or update a tier, mirroring it into Stripe.
   *
   * Stripe prices are immutable, so a changed amount, currency or interval
   * mints a new price and repoints the tier. Existing subscribers stay on the
   * price they signed up on, which is the behaviour Stripe enforces anyway and
   * the one a reader expects.
   */
  async saveTier(input: TierInput): Promise<TierView> {
    if (!billingConfigured())
      throw new Error('Set STRIPE_SECRET_KEY before creating paid tiers.')

    const publication = await publications.ensurePublication()
    const name = String(input.name || '').trim()
    const amountCents = Math.round(Number(input.amountCents) || 0)
    const currency = String(input.currency || 'usd').trim().toLowerCase()
    const interval = String(input.interval || 'month') === 'year' ? 'year' : 'month'

    if (name.length < 2) throw new Error('Give the tier a name.')
    if (amountCents < 100) throw new Error('A paid tier has to be at least 1.00 in its currency.')
    if (currency.length !== 3) throw new Error('Use a three-letter currency code, such as usd.')

    const id = Number(input.id) || 0
    const existing = id
      ? await database.selectFrom('publication_tiers').selectAll().where('id', '=', id).executeTakeFirst()
      : null

    if (id && !existing) throw new Error('That tier does not exist.')

    // Only mint a new Stripe price when the priced shape actually changed.
    const priceChanged = !existing
      || Number(existing.amount_cents) !== amountCents
      || String(existing.currency) !== currency
      || String(existing.interval) !== interval
      || !existing.stripe_price_id

    let stripeProductId: string | null = existing?.stripe_product_id || null
    let stripePriceId: string | null = existing?.stripe_price_id || null

    if (priceChanged) {
      if (!stripeProductId) {
        const product = await stripe.products.create({
          name: `${publication.name}: ${name}`,
          description: String(input.description || '').trim() || undefined,
          metadata: { publication: publication.slug },
        })
        stripeProductId = product.id
      }

      const price = await stripe.prices.create({
        product: stripeProductId,
        unit_amount: amountCents,
        currency,
        recurring: { interval },
        metadata: { publication: publication.slug },
      })
      stripePriceId = price.id
    }

    const values: Record<string, unknown> = {
      name: name.slice(0, 80),
      description: String(input.description || '').trim().slice(0, 500) || null,
      amount_cents: amountCents,
      currency,
      interval,
      stripe_product_id: stripeProductId,
      stripe_price_id: stripePriceId,
      active: input.active === undefined ? 1 : (input.active === false || input.active === 'false' || input.active === 0 ? 0 : 1),
      publication_id: publication.id,
      updated_at: now(),
    }

    if (existing) {
      await database.updateTable('publication_tiers').set(values).where('id', '=', existing.id).execute()

      return tierRow(await database.selectFrom('publication_tiers').selectAll().where('id', '=', existing.id).executeTakeFirstOrThrow())
    }

    const tierUuid = uuid()
    await database.insertInto('publication_tiers').values({
      ...values,
      uuid: tierUuid,
      sort_order: (await this.listTiers()).length,
      created_at: now(),
    }).execute()

    return tierRow(await database.selectFrom('publication_tiers').selectAll().where('uuid', '=', tierUuid).executeTakeFirstOrThrow())
  }

  /**
   * Archive a tier.
   *
   * Never deleted: existing subscribers point at it, and their plan, price and
   * history would become unreadable. Archiving takes it off the page and
   * deactivates the Stripe price so nobody new can reach it.
   */
  async archiveTier(id: number): Promise<void> {
    const tier = await database.selectFrom('publication_tiers').selectAll().where('id', '=', id).executeTakeFirst()
    if (!tier) throw new Error('That tier does not exist.')

    if (tier.stripe_price_id) {
      try {
        await stripe.prices.update(String(tier.stripe_price_id), { active: false })
      }
      catch {
        // A price Stripe has already archived, or a key rotated since. The
        // local deactivation below is what actually takes it off the page.
      }
    }

    await database.updateTable('publication_tiers')
      .set({ active: 0, updated_at: now() })
      .where('id', '=', id)
      .execute()
  }

  /**
   * Start checkout for a reader.
   *
   * The reader is created (or found) as a subscriber first, so the webhook has
   * a row to attach the subscription to no matter which order things complete
   * in. Their id rides on the session metadata rather than being looked up by
   * email later, because an address can be changed on Stripe's own page.
   */
  async checkout(input: { tierId: unknown, email: unknown, name?: unknown, sourceEntryId?: unknown, returnUrl?: unknown }): Promise<{ url: string }> {
    if (!billingConfigured()) throw new Error('This publication is not set up to take payments yet.')

    const tier = await database
      .selectFrom('publication_tiers')
      .selectAll()
      .where('id', '=', Number(input.tierId) || 0)
      .executeTakeFirst()

    if (!tier || !tier.active) throw new Error('That tier is not available.')
    if (!tier.stripe_price_id) throw new Error('That tier is not connected to Stripe yet.')

    const { subscriber } = await subscribers.subscribe({
      email: input.email,
      name: input.name,
      source: 'site',
      sourceEntryId: input.sourceEntryId,
    })

    const base = String(input.returnUrl || env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '')
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: String(tier.stripe_price_id), quantity: 1 }],
      customer_email: subscriber.email,
      success_url: `${base}/subscribe/thanks?session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/`,
      metadata: {
        subscriber_id: String(subscriber.id),
        tier_id: String(tier.id),
      },
      subscription_data: {
        metadata: {
          subscriber_id: String(subscriber.id),
          tier_id: String(tier.id),
        },
      },
    })

    if (!session.url) throw new Error('Stripe did not return a checkout URL.')

    return { url: session.url }
  }

  /**
   * Apply a Stripe webhook.
   *
   * Only the events that change access are handled. Everything else is
   * acknowledged and ignored, because replying with an error to an event we
   * do not care about makes Stripe retry it forever.
   */
  async handleWebhook(event: { type?: string, data?: { object?: any } }): Promise<{ handled: boolean, type: string }> {
    const type = String(event?.type || '')
    const object = event?.data?.object || {}

    switch (type) {
      case 'checkout.session.completed': {
        await this.activateFromSession(object)
        return { handled: true, type }
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        await this.syncSubscription(object)
        return { handled: true, type }
      }

      case 'customer.subscription.deleted': {
        await this.endSubscription(object)
        return { handled: true, type }
      }

      default:
        return { handled: false, type }
    }
  }

  private async activateFromSession(session: any): Promise<void> {
    const subscriberId = Number(session?.metadata?.subscriber_id) || 0
    const tierId = Number(session?.metadata?.tier_id) || 0
    if (!subscriberId) return

    await database.updateTable('publication_subscribers').set({
      plan: 'paid',
      status: 'active',
      // Paying is a stronger opt-in than clicking a link in an email, so a
      // paid reader is confirmed by the payment itself.
      confirmed_at: now(),
      confirmation_token: null,
      publication_tier_id: tierId || null,
      stripe_customer_id: session?.customer ? String(session.customer) : null,
      stripe_subscription_id: session?.subscription ? String(session.subscription) : null,
      updated_at: now(),
    }).where('id', '=', subscriberId).execute()

    await this.creditConversion(subscriberId)
    await subscribers.refreshSubscriberCount()
  }

  private async syncSubscription(subscription: any): Promise<void> {
    const row = await this.findByStripeSubscription(subscription)
    if (!row) return

    const status = String(subscription?.status || '')
    // `past_due` keeps access: Stripe is still retrying the card, and cutting
    // a reader off mid-retry is both hostile and usually wrong.
    const active = ['active', 'trialing', 'past_due'].includes(status)

    await database.updateTable('publication_subscribers').set({
      plan: active ? 'paid' : 'free',
      status: active ? 'active' : row.status === 'unsubscribed' ? 'unsubscribed' : 'active',
      current_period_end: sqliteFromUnix(subscription?.current_period_end),
      cancels_at: subscription?.cancel_at ? sqliteFromUnix(subscription.cancel_at) : null,
      stripe_customer_id: subscription?.customer ? String(subscription.customer) : row.stripe_customer_id,
      stripe_subscription_id: String(subscription?.id || row.stripe_subscription_id),
      updated_at: now(),
    }).where('id', '=', row.id).execute()

    await subscribers.refreshSubscriberCount()
  }

  private async endSubscription(subscription: any): Promise<void> {
    const row = await this.findByStripeSubscription(subscription)
    if (!row) return

    // Downgraded to free rather than removed. They are still a reader, and
    // still on the free list unless they unsubscribe.
    await database.updateTable('publication_subscribers').set({
      plan: 'free',
      publication_tier_id: null,
      stripe_subscription_id: null,
      cancels_at: null,
      current_period_end: null,
      updated_at: now(),
    }).where('id', '=', row.id).execute()

    await subscribers.refreshSubscriberCount()
  }

  /**
   * Find the reader a Stripe subscription belongs to.
   *
   * Metadata first, since it survives an email change on Stripe's side; the
   * subscription id second, for events on subscriptions created before the
   * metadata existed.
   */
  private async findByStripeSubscription(subscription: any) {
    const subscriberId = Number(subscription?.metadata?.subscriber_id) || 0
    if (subscriberId) {
      const byMetadata = await database
        .selectFrom('publication_subscribers')
        .selectAll()
        .where('id', '=', subscriberId)
        .executeTakeFirst()
      if (byMetadata) return byMetadata
    }

    const stripeId = String(subscription?.id || '')
    if (!stripeId) return null

    return await database
      .selectFrom('publication_subscribers')
      .selectAll()
      .where('stripe_subscription_id', '=', stripeId)
      .executeTakeFirst()
  }

  /** Credit the Discover entry that won a paying reader, once. */
  private async creditConversion(subscriberId: number): Promise<void> {
    const row = await database
      .selectFrom('publication_subscribers')
      .select(['source_entry_id', 'confirmed_at'])
      .where('id', '=', subscriberId)
      .executeTakeFirst()

    if (!row?.source_entry_id) return

    try {
      const { discover } = await import('./DiscoverService')
      await discover.recordConversion(Number(row.source_entry_id))
    }
    catch {
      // Ranking attribution must never fail a payment.
    }
  }
}

export const billing = new BillingService()
