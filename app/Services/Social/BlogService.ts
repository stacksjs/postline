import type { BlogAttachment } from '../../Support/Social/blog-attachments'
import type { CrosspostTargetResult, PublishContent } from '../../Support/Social/types'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { db } from '@stacksjs/database'
import { ensureAccount, now, uuid } from './support'
import { classifyFailure } from '../../Support/Social/retry'
import { blogBodyWithAttachments, readBlogAttachments, removeBlogAttachments, saveBlogAttachments } from '../../Support/Social/blog-attachments'
import { blogFile, writePublishedBlogFile } from '../../Support/Social/blog-files'
import { UserFacingError } from '../../Support/Http/user-error'

const database = db as any

/** Postline's own blog has no external character ceiling worth enforcing. */
const BLOG_CHARACTER_LIMIT = 10000

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

/**
 * A URL slug from a title, in any script. Latin accents drop to their base
 * letter (café, cafe); other scripts keep their letters, so a Japanese or
 * Greek title is not emptied to "post" (#117). Marks inside a script (kana
 * voicing, Devanagari vowel signs) are kept and recomposed.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, '')
    .normalize('NFC')
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
    if (!existing && !existsSync(blogFile(candidate))) return candidate
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

    let attachments: BlogAttachment[] = []
    let markdownPath: string | null = null
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
      const articleText = explicitTitle
        ? body
        : post.body.split('\n').slice(firstContentIndex + 1).join('\n').trim() || body

      attachments = await saveBlogAttachments(content?.media || [])
      const markdownBody = blogBodyWithAttachments(articleText, slug, attachments)
      await writePublishedBlogFile(slug, title, publishedAt, markdownBody, undefined, 'wx')
      markdownPath = blogFile(slug)

      const url = `/blog/${slug}`
      await database.transaction((tx: typeof database) => {
        tx.insertInto('blog_posts').values({
          uuid: uuid(),
          title,
          slug,
          body,
          published_body: markdownBody,
          attachments: attachments.length ? JSON.stringify(attachments) : null,
          excerpt: body.slice(0, 280),
          status: 'published',
          published_at: publishedAt,
          post_id: post.id,
          account_id: accountId,
          created_at: publishedAt,
          updated_at: publishedAt,
        }).execute()

        tx.updateTable('post_targets').set({
          status: 'published',
          remote_uri: url,
          failure_reason: null,
          updated_at: publishedAt,
        }).where('id', '=', target.id).execute()
      })

      return { provider: 'blog', ok: true, url, uri: url, targetId: Number(target.id) }
    }
    catch (error) {
      if (markdownPath) await rm(markdownPath, { force: true }).catch(() => {})
      await removeBlogAttachments(attachments).catch(() => {})
      const message = error instanceof Error ? error.message : String(error)
      await database.updateTable('post_targets').set({
        status: 'failed',
        failure_reason: message.slice(0, 1000),
        updated_at: now(),
      }).where('id', '=', target.id).execute()

      return { provider: 'blog', ok: false, error: message, targetId: Number(target.id), retry: classifyFailure(error) }
    }
  }

  /**
   * Bring one post over from another platform (ImportService). Keyed on the
   * slug: a post already there under it is updated, so running an import
   * twice does not duplicate it. A new one is published with its file, so it
   * appears on the blog like any other.
   */
  async importPost(input: {
    title: string
    body: string
    slug?: string
    publishedAt: string
    status?: 'published' | 'draft'
    access?: 'free' | 'paid'
    images?: PublishContent['media']
  }, options: { dryRun?: boolean, createdThisRun?: Set<string> } = {}): Promise<'created' | 'updated'> {
    const title = input.title.trim().slice(0, 200)
    const body = input.body.trim()
    const wanted = input.slug?.trim() ? slugify(input.slug) : slugify(title)
    const existing = await database.selectFrom('blog_posts').selectAll().where('slug', '=', wanted).executeTakeFirst()
    // A post with this slug that came from the same title (or the row named
    // the slug) is this post again. Anything else keeps its slug and the new
    // one gets the next free one.
    // One made earlier in this same import is a different post with the same
    // title (two "Weekly update" rows), not this one again.
    const madeThisRun = options.createdThisRun?.has(wanted) ?? false
    const same = existing && !madeThisRun && (input.slug?.trim() || String(existing.title) === title)

    if (options.dryRun) {
      if (!same) options.createdThisRun?.add(wanted)
      return same ? 'updated' : 'created'
    }

    const slug = same ? String(existing.slug) : await uniqueSlug(wanted)
    const status = input.status ?? (same && existing.status === 'draft' ? 'draft' : 'published')
    const access = input.access ?? (same && existing.access === 'paid' ? 'paid' : 'free')
    const publicArticle = status === 'published' && access === 'free'
    const wasPublic = same && existing.status === 'published' && existing.access === 'free'
    options.createdThisRun?.add(wanted)
    options.createdThisRun?.add(slug)
    const previous = same ? readBlogAttachments(existing.attachments) : []
    const attachments = input.images === undefined ? previous : await saveBlogAttachments(input.images)
    const markdownBody = blogBodyWithAttachments(body, slug, attachments)
    const updatedAt = now()
    const values = {
      title,
      body,
      published_body: markdownBody,
      attachments: attachments.length ? JSON.stringify(attachments) : null,
      excerpt: body.slice(0, 280),
      status,
      access,
      published_at: input.publishedAt,
      updated_at: updatedAt,
    }

    let changedFile = false
    try {
      if (same) {
        if (publicArticle) {
          const flag = wasPublic ? 'w' : 'wx'
          await writePublishedBlogFile(slug, title, input.publishedAt, markdownBody, undefined, flag)
          changedFile = true
        }
        else if (wasPublic) {
          await rm(blogFile(slug), { force: true })
          changedFile = true
        }
        await database.updateTable('blog_posts').set(values).where('id', '=', existing.id).execute()
      }
      else {
        if (publicArticle) {
          await writePublishedBlogFile(slug, title, input.publishedAt, markdownBody, undefined, 'wx')
          changedFile = true
        }
        await database.insertInto('blog_posts').values({
          ...values,
          uuid: uuid(),
          slug,
          account_id: await ensureAccount(),
          created_at: updatedAt,
        }).execute()
      }
    }
    catch (error) {
      if (changedFile) {
        if (wasPublic) {
          await writePublishedBlogFile(slug, String(existing.title), String(existing.published_at || existing.created_at),
            String(existing.published_body ?? existing.body)).catch(() => {})
        }
        else await rm(blogFile(slug), { force: true }).catch(() => {})
      }
      if (input.images !== undefined) await removeBlogAttachments(attachments).catch(() => {})
      throw error
    }
    if (input.images !== undefined) await removeBlogAttachments(previous)
    if (same) return 'updated'
    return 'created'
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
    const slug = String(row.slug)
    const markdownBody = blogBodyWithAttachments(body, slug, readBlogAttachments(row.attachments))
    if (row.status === 'published' && row.access === 'free') await writePublishedBlogFile(slug, title, String(row.published_at || updatedAt), markdownBody)
    await database.updateTable('blog_posts')
      .set({ title, body, published_body: markdownBody, excerpt: body.slice(0, 280), updated_at: updatedAt })
      .where('id', '=', row.id)
      .execute()
    return toView({ ...row, title, body, excerpt: body.slice(0, 280) })
  }

  /** Take a post off the site. It stays here, and can be published again. */
  async unpublish(id: number): Promise<BlogPostView> {
    const row = await this.find(id)
    await rm(blogFile(String(row.slug)), { force: true })
    await database.updateTable('blog_posts').set({ status: 'draft', updated_at: now() }).where('id', '=', row.id).execute()
    return toView({ ...row, status: 'draft' })
  }

  /** Put a taken-down post back on the site, at the address it had. */
  async republish(id: number): Promise<BlogPostView> {
    const row = await this.find(id)
    if (row.access === 'free' && row.status !== 'published' && existsSync(blogFile(String(row.slug))))
      throw new UserFacingError(`Another file already uses /blog/${row.slug}. Rename it, then try again.`)
    const publishedAt = row.published_at || now()
    if (row.access === 'free') await writePublishedBlogFile(String(row.slug), String(row.title), String(publishedAt), String(row.published_body ?? row.body))
    await database.updateTable('blog_posts').set({ status: 'published', published_at: publishedAt, updated_at: now() }).where('id', '=', row.id).execute()
    return toView({ ...row, status: 'published', published_at: publishedAt })
  }

  /** Delete a post for good: its page and its record. */
  async remove(id: number): Promise<void> {
    const row = await this.find(id)
    await rm(blogFile(String(row.slug)), { force: true })
    await database.deleteFrom('blog_posts').where('id', '=', row.id).execute()
    await removeBlogAttachments(readBlogAttachments(row.attachments))
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
