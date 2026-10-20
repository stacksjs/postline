import { Seeder } from '@stacksjs/database'
import { db } from '@stacksjs/database'
import { log } from '@stacksjs/logging'

/**
 * The publication every reader surface renders, plus its paid tiers.
 *
 * Without a row here `/read` renders "Nothing published yet" no matter how many
 * blog_posts exist, so this is the difference between an app that looks broken
 * and one you can actually walk through.
 *
 * Deterministic on purpose: the slug and the tier names are asserted on by the
 * end-to-end walkthrough, so they are fixed rather than faked.
 */
export default class Publication extends Seeder {
  static order = 20
  static tags = ['core', 'e2e']

  async run(): Promise<void> {
    const slug = 'the-open-times'

    const existing = await db
      .selectFrom('publications')
      .select(['id'])
      .where('slug', '=', slug)
      .executeTakeFirst()

    if (existing) {
      log.info(`Publication: "${slug}" already exists — leaving it alone.`)
      await this.seedTiers(Number(existing.id))
      return
    }

    // The publication belongs to an account. The factory pass seeds one; if it
    // was skipped, say so rather than inserting an orphan whose account_id
    // points at nothing.
    const account = await db.selectFrom('accounts').select(['id']).executeTakeFirst()
    if (!account) {
      log.warn('Publication: no account row to attach to — run the model pass first (buddy seed).')
      return
    }

    const now = new Date().toISOString()

    await db
      .insertInto('publications')
      .values({
        name: 'The Open Times',
        slug,
        tagline: 'Publish it. Send it. Own it.',
        description: 'An independent paper you actually own: the publication, the newsletter and the paying subscribers, on software you run.',
        // Left null deliberately. A custom domain is inert until something
        // resolves it from the Host header, which nothing does yet — see
        // stacksjs/postline#42. Seeding one would imply a feature that is
        // not wired up.
        domain: null,
        author_name: 'Chris Breuer',
        listed: true,
        // Counters, not facts. The app recalculates them; starting at zero
        // means a wrong number here can never be mistaken for a real one.
        subscriber_count: 0,
        entry_count: 0,
        account_id: account.id,
        created_at: now,
        updated_at: now,
      })
      .execute()

    const inserted = await db
      .selectFrom('publications')
      .select(['id'])
      .where('slug', '=', slug)
      .executeTakeFirst()

    log.success('Publication: seeded "The Open Times"')

    if (inserted)
      await this.seedTiers(Number(inserted.id))
  }

  /**
   * Two paid tiers and nothing else: enough to exercise tier selection, the
   * access gate on a post, and checkout, without pretending at a price list
   * nobody decided on.
   *
   * No Stripe ids — those belong to a real Stripe account, and a fake one would
   * fail at checkout in a way that looks like a bug in the app.
   */
  private async seedTiers(publicationId: number): Promise<void> {
    const tiers = [
      { name: 'Monthly', description: 'Every edition, as it is published.', amount_cents: 800, interval: 'month', sort_order: 1 },
      { name: 'Annual', description: 'Every edition, two months free.', amount_cents: 8000, interval: 'year', sort_order: 2 },
    ]

    const now = new Date().toISOString()

    for (const tier of tiers) {
      const existing = await db
        .selectFrom('publication_tiers')
        .select(['id'])
        .where('publication_id', '=', publicationId)
        .where('name', '=', tier.name)
        .executeTakeFirst()

      if (existing)
        continue

      await db
        .insertInto('publication_tiers')
        .values({
          ...tier,
          currency: 'usd',
          active: true,
          publication_id: publicationId,
          created_at: now,
          updated_at: now,
        })
        .execute()

      log.success(`Publication: seeded tier "${tier.name}"`)
    }
  }
}
