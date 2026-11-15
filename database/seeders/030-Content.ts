import { Seeder } from '@stacksjs/database'
import { db } from '@stacksjs/database'
import { log } from '@stacksjs/logging'

interface SeedPost {
  title: string
  slug: string
  excerpt: string
  body: string
  status: 'draft' | 'published' | 'archived'
  /** Days before now. Published posts need an ordering the list can show. */
  daysAgo: number | null
}

/**
 * Blog posts covering the states that behave differently, rather than volume.
 *
 * The model factory pass is the right tool for "give me 50 rows". This is the
 * opposite: one post per branch the blog code actually takes, so walking the
 * app exercises each of them once.
 *
 * | Post | Exercises |
 * |---|---|
 * | published | the ordinary list on the Blog page, newest first |
 * | draft | that unpublished work never shows up as published |
 * | archived | that it drops out of the list without being deleted |
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
        title: 'Compose once, publish everywhere',
        slug: 'compose-once-publish-everywhere',
        excerpt: 'One draft, a variant per network where it matters, and a queue that sends them on time.',
        body: longBody('Every network wants the same announcement in a slightly different shape: a different length, a different tone, a different idea of what a link is.'),
        status: 'published',
        daysAgo: 6,
      },
      {
        title: 'What a launch week looks like in the queue',
        slug: 'what-a-launch-week-looks-like-in-the-queue',
        excerpt: 'A campaign is a calendar with opinions. Here is one, day by day.',
        body: longBody('A launch is not one post. It is a teaser, a story, proof, the announcement itself and the follow-up, spread over the days when people are paying attention.'),
        status: 'published',
        daysAgo: 2,
      },
      {
        title: 'Notes on the next release',
        slug: 'notes-on-the-next-release',
        excerpt: 'Unfinished on purpose.',
        body: 'Still being written. If this is listed as published, the draft gate is broken.',
        status: 'draft',
        daysAgo: null,
      },
      {
        title: 'A post we pulled',
        slug: 'a-post-we-pulled',
        excerpt: 'Archived rather than deleted, so the row survives.',
        body: 'Archived. It should not appear in the published list.',
        status: 'archived',
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

    log.success(`Content: seeded ${seeded} blog post(s) across published/draft/archived`)
  }
}

/** A few paragraphs, so the list has an excerpt-length body to clamp. */
function longBody(opening: string): string {
  return [
    opening,
    '',
    'Writing it once and pasting it six times is how the fourth network ends up with a truncated sentence and the fifth gets skipped entirely.',
    '',
    'So the draft is shared, the overrides are per network, and the schedule is one calendar. What goes out is what you approved, where and when you said.',
  ].join('\n')
}
