import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { db } from '@stacksjs/database'
import { blog } from '../../app/Services/Social/BlogService'
import { restorePublishedBlog } from '../../app/Support/Social/blog-files'
import { publicBlogPost, publicBlogPosts } from '../../app/Support/Social/public-blog'

const database = db as any
const dir = (): string => process.env.POSTLINE_BLOG_DIR!

async function publish(text: string, title?: string) {
  const uuid = crypto.randomUUID()
  await database.insertInto('posts').values({ uuid, title: 'blog', body: text, status: 'draft', source: 'composer', timezone: 'UTC' }).execute()
  const postId = Number((await database.selectFrom('posts').select(['id']).where('uuid', '=', uuid).executeTakeFirstOrThrow()).id)
  const result = await blog.publishToPost({ id: postId, body: text }, title ? { title } : undefined)
  expect(result.ok).toBe(true)
  const slug = String(result.url).replace('/blog/', '')
  const row = await database.selectFrom('blog_posts').selectAll().where('slug', '=', slug).executeTakeFirstOrThrow()
  return { slug, id: Number(row.id), file: join(dir(), `${slug}.md`) }
}

describe('the blog', () => {
  test('a script tag in a post body is written as text', async () => {
    const { file } = await publish('Hello <script>alert(1)</script> and [x](javascript:alert(2))', 'Safe post')
    const written = readFileSync(file, 'utf8')
    expect(written).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(written).not.toContain('<script>')
    expect(written).toContain('[x](#)')
  })

  test('a file already on disk is never overwritten by a new post', async () => {
    mkdirSync(dir(), { recursive: true })
    writeFileSync(join(dir(), 'hand-written.md'), 'mine')
    const { slug } = await publish('Body', 'Hand written')
    expect(slug).toBe('hand-written-2')
    expect(readFileSync(join(dir(), 'hand-written.md'), 'utf8')).toBe('mine')
  })

  test('edit, take down, put back and delete', async () => {
    const { id, file, slug } = await publish('First text', 'Lifecycle')

    const edited = await blog.update(id, { title: 'Lifecycle, edited', body: 'Second <b>text</b>' })
    expect(edited.url).toBe(`/blog/${slug}`)
    expect(readFileSync(file, 'utf8')).toContain('Second &lt;b&gt;text&lt;/b&gt;')
    expect(readFileSync(file, 'utf8')).toContain('title: "Lifecycle, edited"')

    const down = await blog.unpublish(id)
    expect(down.status).toBe('draft')
    expect(down.url).toBeNull()
    expect(existsSync(file)).toBe(false)
    expect((await blog.list(500)).find(post => post.id === id)?.status).toBe('draft')

    const back = await blog.republish(id)
    expect(back.url).toBe(`/blog/${slug}`)
    expect(readFileSync(file, 'utf8')).toContain('Second &lt;b&gt;text&lt;/b&gt;')

    await blog.remove(id)
    expect(existsSync(file)).toBe(false)
    expect((await blog.list(500)).some(post => post.id === id)).toBe(false)
    await expect(blog.unpublish(id)).rejects.toThrow('no longer exists')
  })

  test('an edit needs a title and some text', async () => {
    const { id } = await publish('Text', 'Needs both')
    await expect(blog.update(id, { title: ' ', body: 'x' })).rejects.toThrow('needs a title')
    await expect(blog.update(id, { title: 'x', body: '' })).rejects.toThrow('needs some text')
  })

  test('published Markdown is recoverable with the original heading and URL', async () => {
    const { slug, file } = await publish('東京のお知らせ\n\n**Today’s update**')
    const post = await publicBlogPost(slug)
    expect(post?.url).toBe(`/blog/${encodeURIComponent(slug)}`)
    expect(post?.title).toBe('東京のお知らせ')
    expect(post?.html.trim()).toBe('<p><strong>Today’s update</strong></p>')

    const recovered = join(dir(), 'recovered')
    using snapshot = new Database(process.env.DB_DATABASE_PATH!, { readonly: true })
    await restorePublishedBlog(snapshot, recovered)
    expect(readFileSync(join(recovered, `${slug}.md`), 'utf8')).toBe(readFileSync(file, 'utf8'))
  })

  test('paid and unpublished workspace rows are excluded from the public Blog', async () => {
    const paid = await publish('Reserved text', 'Paid article')
    await database.updateTable('blog_posts').set({ access: 'paid' }).where('id', '=', paid.id).execute()
    const draft = await publish('Draft text', 'Draft article')
    await blog.unpublish(draft.id)

    expect(await publicBlogPost(paid.slug)).toBeNull()
    expect(await publicBlogPost(draft.slug)).toBeNull()
    const urls = (await publicBlogPosts()).map(post => post.url)
    expect(urls).not.toContain(`/blog/${paid.slug}`)
    expect(urls).not.toContain(`/blog/${draft.slug}`)
    const recovered = join(dir(), 'excluded')
    using snapshot = new Database(process.env.DB_DATABASE_PATH!, { readonly: true })
    await restorePublishedBlog(snapshot, recovered)
    expect(existsSync(join(recovered, `${paid.slug}.md`))).toBe(false)
    expect(existsSync(join(recovered, `${draft.slug}.md`))).toBe(false)
  })

  test('backups predating the dedicated published body still recover published files', async () => {
    const recovered = join(dir(), 'legacy')
    using snapshot = new Database(':memory:')
    snapshot.run('CREATE TABLE blog_posts (slug TEXT, title TEXT, body TEXT, status TEXT, published_at TEXT, created_at TEXT)')
    snapshot.run('INSERT INTO blog_posts VALUES (?, ?, ?, ?, ?, ?)', ['old-url', 'Old title', 'Old text', 'published', null, '2025-04-02 10:00:00'])
    await restorePublishedBlog(snapshot, recovered)
    expect(readFileSync(join(recovered, 'old-url.md'), 'utf8')).toContain('date: 2025-04-02\nauthor: Postline\n---\n\nOld text')
  })
})
