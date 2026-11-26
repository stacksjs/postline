import { formatPostDate, loadPost, loadPosts } from '@stacksjs/cms/blog'
import { renderSafeMarkdown } from '@stacksjs/cms/markdown'
import { db } from '@stacksjs/database'
import { blogDirectory } from './blog-files'

interface PublicPost {
  title: string
  url: string
  date: string
  dateLabel: string
  excerpt: string
}

function publicPost(slug: string, title: string, date: string, excerpt: string): PublicPost {
  const day = date.slice(0, 10)
  return { title, url: `/blog/${encodeURIComponent(slug)}`, date: day, dateLabel: formatPostDate(day), excerpt }
}

export async function publicBlogPosts(): Promise<PublicPost[]> {
  const rows = await db.selectFrom('blog_posts')
    .select(['slug', 'title', 'published_at', 'created_at', 'excerpt', 'status', 'access'])
    .execute()
  const workspaceSlugs = new Set(rows.map(row => row.slug))
  const workspacePosts = rows.filter(row => row.status === 'published' && row.access === 'free')
    .map(row => publicPost(row.slug, row.title, row.published_at || row.created_at, row.excerpt ?? ''))
  const markdownPosts = loadPosts({ dir: blogDirectory() })
    .filter(post => !workspaceSlugs.has(post.slug))
    .map(post => publicPost(post.slug, post.title, post.date, post.description))
  return [...workspacePosts, ...markdownPosts].sort((a, b) => b.date.localeCompare(a.date))
}

export async function publicBlogPost(slug: string): Promise<PublicPost & { html: string } | null> {
  const row = await db.selectFrom('blog_posts')
    .select(['slug', 'title', 'status', 'access', 'published_at', 'created_at', 'excerpt', 'body', 'published_body'])
    .where('slug', '=', slug)
    .executeTakeFirst()
  if (row) {
    if (row.status !== 'published' || row.access !== 'free') return null
    return {
      ...publicPost(row.slug, row.title, row.published_at || row.created_at, row.excerpt ?? ''),
      html: renderSafeMarkdown(row.published_body ?? row.body),
    }
  }
  const markdown = loadPost(slug, { dir: blogDirectory() })
  return markdown
    ? { ...publicPost(slug, markdown.title, markdown.date, markdown.description), html: renderSafeMarkdown(markdown.body) }
    : null
}
