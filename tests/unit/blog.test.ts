import type { PublishContent } from '../../app/Support/Social/types'
import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { db } from '@stacksjs/database'
import { featureTest } from '@stacksjs/testing'
import { blog } from '../../app/Services/Social/BlogService'
import { postQueue } from '../../app/Services/Social/QueueService'
import { workspaceArchive } from '../../app/Services/WorkspaceArchiveService'
import { readBlogAttachments } from '../../app/Support/Social/blog-attachments'
import { referencedMediaFiles } from '../../app/Support/Social/stored-content'
import { buildMediaUrl, MEDIA_DIR } from '../../app/Support/Social/uploads'
import { restorePublishedBlog } from '../../app/Support/Social/blog-files'
import { publicBlogPost, publicBlogPosts } from '../../app/Support/Social/public-blog'

const database = db as any
const dir = (): string => process.env.POSTLINE_BLOG_DIR!

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=', 'base64')

async function publish(text: string, title?: string, media?: PublishContent['media']) {
  const uuid = crypto.randomUUID()
  await database.insertInto('posts').values({ uuid, title: 'blog', body: text, status: 'draft', source: 'composer', timezone: 'UTC' }).execute()
  const postId = Number((await database.selectFrom('posts').select(['id']).where('uuid', '=', uuid).executeTakeFirstOrThrow()).id)
  const result = await blog.publishToPost({ id: postId, body: text }, { title, media })
  expect(result.ok).toBe(true)
  const slug = String(result.url).replace('/blog/', '')
  const row = await database.selectFrom('blog_posts').selectAll().where('slug', '=', slug).executeTakeFirstOrThrow()
  return { slug, id: Number(row.id), file: join(dir(), `${slug}.md`), attachments: readBlogAttachments(row.attachments) }
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

  test('publishes images in order and serves them only while the article is public', async () => {
    const { id, slug, attachments } = await publish('The article', 'Images', [
      { bytes: png, altText: 'First photo' },
      { bytes: png, altText: 'A second photo' },
    ])
    const names = attachments.map(attachment => attachment.file)
    expect(attachments.map(attachment => attachment.alt)).toEqual(['First photo', 'A second photo'])
    const html = (await publicBlogPost(slug))!.html
    expect(html).toContain('alt="First photo"')
    expect(html).toContain('alt="A second photo"')
    expect(html.indexOf(names[0]!)).toBeLessThan(html.indexOf(names[1]!))
    const blogImage = `/api/postline/blog/media?slug=${slug}&file=${names[0]}`
    ;(await featureTest().get(blogImage)).assertStatus(200)
    const providerUrl = new URL(buildMediaUrl('https://posts.example.com', names[0]!, process.env.APP_KEY)!)
    ;(await featureTest().get(`${providerUrl.pathname}${providerUrl.search}`)).assertStatus(404)

    await blog.update(id, { title: 'Updated images', body: 'Replacement article text' })
    expect((await publicBlogPost(slug))?.html).toContain('alt="First photo"')
    await blog.unpublish(id)
    ;(await featureTest().get(blogImage)).assertStatus(404)
    await blog.republish(id)
    ;(await featureTest().get(blogImage)).assertStatus(200)
    await blog.remove(id)
    expect(names.every(file => !existsSync(join(MEDIA_DIR, file)))).toBe(true)
  })

  test('a scheduled article keeps its own copy after the queue clears its image', async () => {
    const scheduledAt = new Date(Date.now() + 60_000).toISOString().slice(0, 19).replace('T', ' ')
    const { postId } = await postQueue.save({
      title: 'Scheduled Blog media', text: 'An article with a picture', providers: ['blog'], scheduledAt,
      images: [{ bytes: png, mimeType: 'image/png', altText: 'A scheduled image' }],
    })
    const queued = await database.selectFrom('posts').select('content').where('id', '=', postId).executeTakeFirstOrThrow()
    const queuedFile = referencedMediaFiles(queued.content)[0]!
    const past = new Date(Date.now() - 1000).toISOString().slice(0, 19).replace('T', ' ')
    await database.updateTable('posts').set({ scheduled_at: past }).where('id', '=', postId).execute()
    await postQueue.publishDue()

    const published = await database.selectFrom('blog_posts').selectAll().where('post_id', '=', postId).executeTakeFirstOrThrow()
    const attachment = readBlogAttachments(published.attachments)[0]!
    expect(existsSync(join(MEDIA_DIR, queuedFile))).toBe(false)
    expect(attachment.file).not.toBe(queuedFile)
    expect(readFileSync(join(MEDIA_DIR, attachment.file))).toEqual(png)
    expect((await publicBlogPost(published.slug))?.html).toContain('alt="A scheduled image"')
  })

  test('workspace archives keep Blog images and paid access', async () => {
    const { id, slug } = await publish('Subscriber text', 'Subscriber image', [{ bytes: png, altText: 'Subscriber photo' }])
    await database.updateTable('blog_posts').set({ access: 'paid' }).where('id', '=', id).execute()
    const archive = await workspaceArchive.export()
    const entry = archive.blogPosts.find(post => post.slug === slug)!
    expect(entry.attachments).toEqual([{ data: png.toString('base64'), alt: 'Subscriber photo' }])
    await blog.remove(id)
    await workspaceArchive.import({ ...archive, posts: [], targets: [], campaigns: [], campaignPosts: [], monitors: [], media: {}, blogPosts: [entry] })

    const imported = await database.selectFrom('blog_posts').selectAll().where('slug', '=', slug).executeTakeFirstOrThrow()
    expect(imported.access).toBe('paid')
    expect(await publicBlogPost(slug)).toBeNull()
    const attachment = readBlogAttachments(imported.attachments)[0]!
    expect(readFileSync(join(MEDIA_DIR, attachment.file))).toEqual(png)
    ;(await featureTest().get(`/api/postline/blog/media?slug=${slug}&file=${attachment.file}`)).assertStatus(404)
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
