import type { CrosspostTargetResult, PublishContent } from '../../Support/Social/types'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { db } from '@stacksjs/database'
import { ensureAccount, now, uuid } from './support'

const database = db as any

// The framework's BunPress blog renders markdown from content/blog/*.md at
// /blog/<slug> — publishing a file there makes the post immediately live.
const CONTENT_DIR = join(process.cwd(), 'content/blog')

/** Postline's own blog has no external character ceiling worth enforcing. */
const BLOG_CHARACTER_LIMIT = 10000

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-')
    .slice(0, 80)
    .replace(/^-+|-+$/g, '') || 'post'
}

async function uniqueSlug(base: string): Promise<string> {
  let candidate = base
  for (let attempt = 2; attempt < 50; attempt++) {
    const existing = await database
      .selectFrom('blog_posts')
      .select(['id'])
      .where('slug', '=', candidate)
      .executeTakeFirst()
    if (!existing) return candidate
    candidate = `${base}-${attempt}`
  }
  return `${base}-${uuid().slice(0, 8)}`
}

/**
 * The blog is "just another crosspost target": publishing writes a
 * `blog_posts` row instead of calling an external API. The first line of
 * the text becomes the title, the rest the body.
 */
export class BlogService {
  async status(): Promise<{ provider: 'blog', handle: string, canPublish: boolean, characterLimit: number, configured: boolean }> {
    return {
      provider: 'blog',
      handle: 'Postline Blog',
      canPublish: true,
      characterLimit: BLOG_CHARACTER_LIMIT,
      configured: true,
    }
  }

  async publishToPost(
    post: { id: number, body: string },
    content?: PublishContent,
  ): Promise<CrosspostTargetResult> {
    const targetUuid = uuid()
    const createdAt = now()

    await database.insertInto('post_targets').values({
      uuid: targetUuid,
      provider: 'blog',
      status: 'publishing',
      post_id: post.id,
      created_at: createdAt,
      updated_at: createdAt,
    }).execute()

    const target = await database
      .selectFrom('post_targets')
      .selectAll()
      .where('uuid', '=', targetUuid)
      .executeTakeFirstOrThrow()

    try {
      // Explicit title (long-form composer) keeps the whole text as body;
      // otherwise the first line doubles as the title and is stripped.
      const explicitTitle = content?.title?.trim()
      const lines = post.body.split('\n').map(line => line.trim())
      const title = (explicitTitle || lines.find(Boolean) || 'Untitled post').slice(0, 200)
      const body = post.body.trim()
      const slug = await uniqueSlug(slugify(title))
      const accountId = await ensureAccount()
      const publishedAt = now()

      const firstContentIndex = post.body.split('\n').findIndex(line => line.trim())
      const markdownBody = explicitTitle
        ? body
        : post.body.split('\n').slice(firstContentIndex + 1).join('\n').trim() || body

      await mkdir(CONTENT_DIR, { recursive: true })
      await Bun.write(join(CONTENT_DIR, `${slug}.md`), [
        '---',
        `title: ${JSON.stringify(title)}`,
        `date: ${publishedAt.slice(0, 10)}`,
        'author: Postline',
        '---',
        '',
        markdownBody,
        '',
      ].join('\n'))

      await database.insertInto('blog_posts').values({
        uuid: uuid(),
        title,
        slug,
        body,
        excerpt: body.slice(0, 280),
        status: 'published',
        published_at: publishedAt,
        post_id: post.id,
        account_id: accountId,
        created_at: publishedAt,
        updated_at: publishedAt,
      }).execute()

      const url = `/blog/${slug}`
      await database.updateTable('post_targets').set({
        status: 'published',
        remote_uri: url,
        failure_reason: null,
        updated_at: publishedAt,
      }).where('id', '=', target.id).execute()

      return { provider: 'blog', ok: true, url, uri: url, targetId: Number(target.id) }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await database.updateTable('post_targets').set({
        status: 'failed',
        failure_reason: message.slice(0, 1000),
        updated_at: now(),
      }).where('id', '=', target.id).execute()

      return { provider: 'blog', ok: false, error: message, targetId: Number(target.id) }
    }
  }

  /** Published blog posts, newest first. */
  async list(limit = 50): Promise<Array<{ id: number, title: string, slug: string, excerpt: string | null, body: string, publishedAt: string | null }>> {
    const rows = await database
      .selectFrom('blog_posts')
      .selectAll()
      .where('status', '=', 'published')
      .orderBy('published_at', 'desc')
      .limit(limit)
      .execute()

    return rows.map((row: any) => ({
      id: Number(row.id),
      title: String(row.title),
      slug: String(row.slug),
      excerpt: row.excerpt || null,
      body: String(row.body),
      publishedAt: row.published_at || null,
    }))
  }
}

export const blog = new BlogService()
