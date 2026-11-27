import type { DraftFeedItem } from '../../app/Support/Social/draft-feed'
import { describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { DraftFeedService } from '../../app/Services/DraftFeedService'
import { postQueue } from '../../app/Services/Social/QueueService'
import { parseDraftFeed } from '../../app/Support/Social/draft-feed'

const base = new URL('https://example.org/news/feed.xml')
const parse = (source: string) => parseDraftFeed(new TextEncoder().encode(source), base)

describe('draft feed formats', () => {
  test('reads RSS items, deduplicates GUIDs, and preserves public link fragments', () => {
    const items = parse(`<rss version="2.0"><channel><title>News</title>
      <item><guid isPermaLink="false">first</guid><title>A &amp; B</title><link>story#next</link></item>
      <item><guid isPermaLink="false">first</guid><title>Repeated</title></item>
      <item><guid>second</guid><title>Title only</title></item>
    </channel></rss>`)
    expect(items.map(({ title, link }) => [title, link])).toEqual([['A & B', 'https://example.org/news/story#next'], ['Title only', null]])
  })

  test('follows Atom base URLs and alternate links, and reads JSON Feed entries', () => {
    const atom = parse(`<feed xmlns="http://www.w3.org/2005/Atom" xml:base="https://example.com/releases/">
      <entry xml:base="2026/"><id>urn:fixture:first</id><title>Version 1.0</title>
        <link rel="self" href="entry.atom"/><link rel="alternate" href="v1"/>
      </entry></feed>`)
    expect(atom[0]).toMatchObject({ title: 'Version 1.0', link: 'https://example.com/releases/2026/v1' })
    const json = parse(JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', items: [
      { id: 'json-post', content_text: 'New from the blog', url: 'https://example.com/post' },
      { id: 'local-post', title: 'No private address', url: 'http://localhost/private' },
    ] }))
    expect(json.map(({ title, link }) => [title, link])).toEqual([['New from the blog', 'https://example.com/post'], ['No private address', null]])
  })

  test('refuses malformed XML, XML document types, and pages that are not feeds', () => {
    expect(() => parse('<rss><channel></rss>')).toThrow('invalid XML')
    expect(() => parse('<!DOCTYPE rss><rss><channel/></rss>')).toThrow('XML document types')
    expect(() => parse('<html><body>Not a feed</body></html>')).toThrow('RSS, Atom, or JSON feed')
  })
})

describe('feed drafts', () => {
  test('starts at the current feed, creates one editable unscheduled draft, and remembers it after deletion', async () => {
    const tag = crypto.randomUUID()
    const first = { key: '1'.repeat(64), title: `Already seen ${tag}`, link: 'https://example.org/old' }
    const second = { key: '2'.repeat(64), title: `New ${tag}`, link: 'https://example.org/new' }
    let items: DraftFeedItem[] = [first]
    const feeds = new DraftFeedService(async () => items)
    const subscribed = await feeds.subscribe('News', `https://example.org/${tag}.xml`, false)
    try {
      expect(subscribed).toMatchObject({ created: 0, feed: { initialized: true, lastError: null } })
      items = [second, first]
      const checks = await Promise.all([feeds.check(subscribed.feed.uuid), feeds.check(subscribed.feed.uuid)])
      expect(checks.reduce((count, check) => count + check.created, 0)).toBe(1)
      const draft = await db.selectFrom('posts').select(['id', 'source']).where('title', '=', second.title).executeTakeFirstOrThrow()
      expect(draft.source).toBe('import')
      expect(await postQueue.get(Number(draft.id))).toMatchObject({
        status: 'draft', scheduledAt: null, targets: [], text: `${second.title}\n\nhttps://example.org/new`,
      })
      expect(await db.selectFrom('posts').select('id').where('title', '=', first.title).executeTakeFirst()).toBeUndefined()
      await db.deleteFrom('posts').where('id', '=', draft.id).execute()
      expect((await feeds.check(subscribed.feed.uuid)).created).toBe(0)
      await feeds.setActive(subscribed.feed.uuid, false)
      items.unshift({ key: '3'.repeat(64), title: 'Paused', link: null })
      expect((await feeds.check(subscribed.feed.uuid)).created).toBe(0)
    }
    finally {
      await feeds.remove(subscribed.feed.uuid)
    }
  })

  test('records a fetch error and retries an opted-in first import', async () => {
    const tag = crypto.randomUUID()
    const item = { key: '4'.repeat(64), title: `Existing ${tag}`, link: null }
    let unavailable = true
    const feeds = new DraftFeedService(async () => {
      if (unavailable) throw new Error('Fixture network failure')
      return [item]
    })
    const subscribed = await feeds.subscribe('News', `https://example.org/${tag}.xml`, true)
    try {
      expect(subscribed.created).toBe(0)
      expect(subscribed.feed.lastError).toBe('Could not check this feed.')
      unavailable = false
      expect(await feeds.check(subscribed.feed.uuid)).toMatchObject({ created: 1, feed: { lastError: null } })
    }
    finally {
      await feeds.remove(subscribed.feed.uuid)
      await db.deleteFrom('posts').where('title', '=', item.title).execute()
    }
  })

  test('a pause during a fetch preserves the item for after resume', async () => {
    const tag = crypto.randomUUID()
    const item = { key: '5'.repeat(64), title: `After resume ${tag}`, link: null }
    const started = Promise.withResolvers<void>()
    const response = Promise.withResolvers<DraftFeedItem[]>()
    let initial = true
    const feeds = new DraftFeedService(async () => {
      if (initial) { initial = false; return [] }
      started.resolve()
      return response.promise
    })
    const subscribed = await feeds.subscribe('News', `https://example.org/${tag}.xml`, false)
    try {
      const checking = feeds.check(subscribed.feed.uuid)
      await started.promise
      await feeds.setActive(subscribed.feed.uuid, false)
      response.resolve([item])
      expect((await checking).created).toBe(0)
      expect(await db.selectFrom('posts').select('id').where('title', '=', item.title).executeTakeFirst()).toBeUndefined()
      await feeds.setActive(subscribed.feed.uuid, true)
      expect((await feeds.check(subscribed.feed.uuid)).created).toBe(1)
    }
    finally {
      response.resolve([])
      await feeds.remove(subscribed.feed.uuid)
      await db.deleteFrom('posts').where('title', '=', item.title).execute()
    }
  })
})
