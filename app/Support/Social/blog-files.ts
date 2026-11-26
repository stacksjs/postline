import type { Database } from 'bun:sqlite'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { safeMarkdown } from './safe-markdown'

export function blogDirectory(): string {
  return process.env.POSTLINE_BLOG_DIR || join(process.cwd(), 'content/blog')
}

export function blogFile(slug: string, directory = blogDirectory()): string {
  if (!/^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}_-]{0,219}$/u.test(slug))
    throw new Error('The published Blog slug does not name a Markdown file.')
  return join(directory, `${slug}.md`)
}

export async function writePublishedBlogFile(slug: string, title: string, date: string, body: string, directory = blogDirectory(), flag = 'w'): Promise<void> {
  const file = blogFile(slug, directory)
  await mkdir(directory, { recursive: true })
  await writeFile(file, [
    '---',
    `title: ${JSON.stringify(title)}`,
    `date: ${date.slice(0, 10)}`,
    'author: Postline',
    '---',
    '',
    safeMarkdown(body),
    '',
  ].join('\n'), { flag })
}

export async function restorePublishedBlog(database: Database, directory: string): Promise<void> {
  const columns = database.query<{ name: string }, []>('PRAGMA table_info(blog_posts)').all()
  if (!columns.length) return
  const names = new Set(columns.map(column => column.name))
  const body = names.has('published_body') ? 'coalesce(published_body, body)' : 'body'
  const onlyFree = names.has('access') ? " AND access = 'free'" : ''
  const posts = database.query<{ slug: string, title: string, date: string, body: string }, []>(`
    SELECT slug, title, coalesce(published_at, created_at) AS date, ${body} AS body
    FROM blog_posts WHERE status = 'published'${onlyFree}
  `).all()
  for (const post of posts) {
    try {
      await writePublishedBlogFile(post.slug, post.title, post.date, post.body, directory, 'wx')
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
}
