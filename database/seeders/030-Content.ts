import { Seeder } from '@stacksjs/database'
import { db } from '@stacksjs/database'
import { log } from '@stacksjs/logging'

interface SeedPost {
  title: string
  slug: string
  excerpt: string
  body: string
  status: 'draft' | 'published' | 'archived'
  access: 'free' | 'paid'
  /** Days before now. Published posts need an ordering the reader can see. */
  daysAgo: number | null
}

/**
 * Posts covering the states that behave differently, rather than volume.
 *
 * The model factory pass is the right tool for "give me 50 rows". This is the
 * opposite: one post per branch the reader and editor code actually takes, so
 * walking the app exercises each of them once.
 *
 * | Post | Exercises |
 * |---|---|
 * | free + published | the ordinary read path, and the feed |
 * | paid + published | the access gate and the preview_chars truncation |
 * | draft | that unpublished work never leaks to a reader |
 * | archived | that it drops out of the feed without being deleted |
 *
 * `preview_chars` on the paid post is deliberately shorter than the body, so
 * the paywall has something to cut. Equal values would pass a test that a real
 * paywall would fail.
 */
export default class Content extends Seeder {
  static order = 30
  static tags = ['demo', 'e2e']

  async run(): Promise<void> {
    const account = await db.selectFrom('accounts').select(['id']).executeTakeFirst()
    if (!account) {
      log.warn('Content: no account row to attach posts to — run the model pass first.')
      return
    }

    const posts: SeedPost[] = [
      {
        title: 'Why we built our own press',
        slug: 'why-we-built-our-own-press',
        excerpt: 'Owning the publication, the list and the payments turns out to be one decision, not three.',
        body: longBody('Every newsletter platform makes the same trade: they hold the list, they take the cut, and they decide what happens if they ever stop liking you.'),
        status: 'published',
        access: 'free',
        daysAgo: 6,
      },
      {
        title: 'What a paid edition looks like',
        slug: 'what-a-paid-edition-looks-like',
        excerpt: 'The first few hundred characters are free. The rest is for subscribers.',
        body: longBody('This edition is gated. A reader without a subscription sees the opening and then the wall, which is the behaviour worth testing.'),
        status: 'published',
        access: 'paid',
        daysAgo: 2,
      },
      {
        title: 'Notes on the next edition',
        slug: 'notes-on-the-next-edition',
        excerpt: 'Unfinished on purpose.',
        body: 'Still being written. If this is visible to a reader, the draft gate is broken.',
        status: 'draft',
        access: 'free',
        daysAgo: null,
      },
      {
        title: 'An edition we pulled',
        slug: 'an-edition-we-pulled',
        excerpt: 'Archived rather than deleted, so the URL does not rot.',
        body: 'Archived. It should not appear in the feed, and it should not 404 for someone holding the link.',
        status: 'archived',
        access: 'free',
        daysAgo: 30,
      },
    ]

    const now = new Date()
    let seeded = 0

    for (const post of posts) {
      const existing = await db
        .selectFrom('blog_posts')
        .select(['id'])
        .where('slug', '=', post.slug)
        .executeTakeFirst()

      if (existing)
        continue

      const publishedAt = post.daysAgo === null
        ? null
        : new Date(now.getTime() - post.daysAgo * 86_400_000).toISOString()

      await db
        .insertInto('blog_posts')
        .values({
          title: post.title,
          slug: post.slug,
          body: post.body,
          excerpt: post.excerpt,
          status: post.status,
          access: post.access,
          // Shorter than the body, so a paid post genuinely truncates.
          preview_chars: 280,
          published_at: publishedAt,
          account_id: account.id,
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .execute()

      seeded++
    }

    if (seeded === 0) {
      log.info('Content: posts already present — leaving them alone.')
      return
    }

    log.success(`Content: seeded ${seeded} post(s) across free/paid/draft/archived`)

    // entry_count is the publication's own tally of what it has published.
    // Recomputed rather than incremented, so re-running cannot drift it.
    const published = await db
      .selectFrom('blog_posts')
      .select(['id'])
      .where('status', '=', 'published')
      .execute()

    await db
      .updateTable('publications')
      .set({
        entry_count: published.length,
        last_published_at: new Date(now.getTime() - 2 * 86_400_000).toISOString(),
      })
      .where('slug', '=', 'the-open-times')
      .execute()
  }
}

/** Long enough that preview_chars has something to cut. */
function longBody(opening: string): string {
  return [
    opening,
    '',
    'The argument is not that hosted platforms are bad at what they do. It is that the thing they are good at — reach — is the part you give up least when you leave, and the parts you cannot afford to lose are exactly the ones they hold.',
    '',
    'So the test is simple: if the service disappeared tomorrow, what would you still have? The list, the archive, the ability to charge. If the answer is none of those, that is not a publication, it is a tenancy.',
  ].join('\n')
}
