import type { CrosspostTargetResult, PublishContent } from '../../Support/Social/types'
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { db } from '@stacksjs/database'
import { ensureAccount, now, uuid } from './support'
import { classifyFailure } from '../../Support/Social/retry'
import { safeMarkdown } from '../../Support/Social/safe-markdown'
import { UserFacingError } from '../../Support/Http/user-error'

const database = db as any

// The framework's BunPress blog renders markdown from content/blog/*.md at
// /blog/<slug> — publishing a file there makes the post immediately live.
// `POSTLINE_BLOG_DIR` exists for the test suite, which must not write into
// the project's own blog.
function contentDir(): string {
  return process.env.POSTLINE_BLOG_DIR || join(process.cwd(), 'content/blog')
}

/** Postline's own blog has no external character ceiling worth enforcing. */
const BLOG_CHARACTER_LIMIT = 10000

function fileFor(slug: string): string {
  return join(contentDir(), `${slug}.md`)
}

/** The Markdown file the blog renders: front matter, then the body, made safe. */
async function writePostFile(slug: string, title: string, date: string, body: string): Promise<void> {
  await mkdir(contentDir(), { recursive: true })
  await Bun.write(fileFor(slug), [
    '---',
    `title: ${JSON.stringify(title)}`,
    `date: ${date.slice(0, 10)}`,
    'author: Postline',
    '---',
    '',
    safeMarkdown(body),
    '',
  ].join('\n'))
}

export interface BlogPostView {
  id: number
  title: string
  slug: string
  excerpt: string | null
  body: string
  status: 'published' | 'draft'
  publishedAt: string | null
  /** Where it can be read, while it is published. */
  url: string | null
}

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

/**
 * A slug no post uses, in the database or on disk. Checking the database
 * alone let a new post overwrite a Markdown file put there some other way.
 */
async function uniqueSlug(base: string): Promise<string> {
  let candidate = base
  for (let attempt = 2; attempt < 50; attempt++) {
    const existing = await database
      .selectFrom('blog_posts')
      .select(['id'])
      .where('slug', '=', candidate)
      .executeTakeFirst()
    if (!existing && !existsSync(fileFor(candidate))) return candidate
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

      await writePostFile(slug, title, publishedAt, markdownBody)

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

      return { provider: 'blog', ok: false, error: message, targetId: Number(target.id), retry: classifyFailure(error) }
    }
  }

  /** Blog posts, newest first: published ones, and ones taken down. */
  async list(limit = 50): Promise<BlogPostView[]> {
    const rows = await database
      .selectFrom('blog_posts')
      .selectAll()
      .where('status', 'in', ['published', 'draft'])
      .orderBy('id', 'desc')
      .limit(limit)
      .execute()
    return rows.map(toView)
  }

  /**
   * Change a post's title or text. A published post's page changes with it;
   * its address does not, so links to it keep working.
   */
  async update(id: number, input: { title: string, body: string }): Promise<BlogPostView> {
    const row = await this.find(id)
    const title = input.title.trim().slice(0, 200)
    const body = input.body.trim()
    if (!title) throw new UserFacingError('A blog post needs a title.')
    if (!body) throw new UserFacingError('A blog post needs some text.')

    const updatedAt = now()
    if (row.status === 'published') await writePostFile(String(row.slug), title, String(row.published_at || updatedAt), body)
    await database.updateTable('blog_posts')
      .set({ title, body, excerpt: body.slice(0, 280), updated_at: updatedAt })
      .where('id', '=', row.id)
      .execute()
    return toView({ ...row, title, body, excerpt: body.slice(0, 280) })
  }

  /** Take a post off the site. It stays here, and can be published again. */
  async unpublish(id: number): Promise<BlogPostView> {
    const row = await this.find(id)
    await rm(fileFor(String(row.slug)), { force: true })
    await database.updateTable('blog_posts').set({ status: 'draft', updated_at: now() }).where('id', '=', row.id).execute()
    return toView({ ...row, status: 'draft' })
  }

  /** Put a taken-down post back on the site, at the address it had. */
  async republish(id: number): Promise<BlogPostView> {
    const row = await this.find(id)
    if (row.status !== 'published' && existsSync(fileFor(String(row.slug))))
      throw new UserFacingError(`Another file already uses /blog/${row.slug}. Rename it, then try again.`)
    const publishedAt = row.published_at || now()
    await writePostFile(String(row.slug), String(row.title), String(publishedAt), String(row.body))
    await database.updateTable('blog_posts').set({ status: 'published', published_at: publishedAt, updated_at: now() }).where('id', '=', row.id).execute()
    return toView({ ...row, status: 'published', published_at: publishedAt })
  }

  /** Delete a post for good: its page and its record. */
  async remove(id: number): Promise<void> {
    const row = await this.find(id)
    await rm(fileFor(String(row.slug)), { force: true })
    await database.deleteFrom('blog_posts').where('id', '=', row.id).execute()
  }

  private async find(id: number): Promise<any> {
    const row = await database.selectFrom('blog_posts').selectAll().where('id', '=', id).executeTakeFirst()
    if (!row || !['published', 'draft'].includes(String(row.status))) throw new UserFacingError('That blog post no longer exists.')
    return row
  }
}

function toView(row: any): BlogPostView {
  const published = String(row.status) === 'published'
  return {
    id: Number(row.id),
    title: String(row.title),
    slug: String(row.slug),
    excerpt: row.excerpt || null,
    body: String(row.body),
    status: published ? 'published' : 'draft',
    publishedAt: row.published_at || null,
    url: published ? `/blog/${row.slug}` : null,
  }
}

export const blog = new BlogService()
