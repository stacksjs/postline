import { describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { keywordMonitoring } from '../../app/Services/KeywordMonitoringService'
import { postQueue } from '../../app/Services/Social/QueueService'
import { rememberTwitterBrowserHandle, saveTwitterBrowserMetrics, twitterBrowserSession } from '../../app/Services/Social/TwitterBrowserSession'
import { upsertIdentityRow } from '../../app/Services/Social/identities'
import { inspectXPage } from '../../resources/functions/x-browser-session'

describe('X session browser reads', () => {
  test('captures measured zero and exact text counts from the owner’s rendered posts', () => {
    const article = (handle: string) => {
      const row = {
        getClientRects: () => [1],
        querySelector(selector: string) {
          if (selector === 'time') return { closest: () => ({ getAttribute: () => `/${handle}/status/42` }) }
          if (selector.includes('"like"')) return control('', '0 Likes. Like')
          if (selector.includes('"reply"')) return control('1.2K')
          if (selector.includes('analytics')) return control('1,440')
          return null
        },
      }
      const control = (textContent: string, label = '') => ({
        textContent,
        getAttribute: () => label,
        getClientRects: () => [1],
        closest: () => row,
      })
      return row
    }
    const document = {
      querySelector: (selector: string) => selector.includes('Profile_Link') ? { getAttribute: () => '/postline_test' } : null,
      querySelectorAll: () => [article('postline_test'), article('another_user')],
    } as unknown as Document
    expect(inspectXPage(document, 'https://x.com/postline_test', 'metrics')).toEqual({
      state: 'connected',
      handle: 'postline_test',
      measurements: [{ id: '42', counts: { likes: 0, views: 1440 } }],
    })
    expect(inspectXPage(document, 'https://x.com/account/access', 'metrics')).toEqual({ state: 'needs-attention' })
    expect(inspectXPage(document, 'https://example.test/postline_test', 'metrics')).toEqual({ state: 'unavailable' })
  })

  test('reads exact engagement from the current timeline row and ignores a nested post count', () => {
    const article = {
      parentElement: { querySelector: () => ({ getAttribute: () => '/postline_test/status/2126032940035445011' }) },
      getClientRects: () => [1],
      querySelector(selector: string) {
        if (selector.includes('action="reply"')) return control('1.9K', '1926 Replies. Reply')
        if (selector.includes('action="retweet"')) return control('2K', '2051 reposts. Repost')
        if (selector.includes('action="like"')) return control('13K', '13107 Likes. Like', { quoted: true })
        if (selector.includes('View count')) return control('1.7M', 'View count')
        return null
      },
    }
    function control(textContent: string, label: string, owner: object = article) {
      return { textContent, getAttribute: () => label, getClientRects: () => [1], closest: () => owner }
    }
    const document = {
      querySelector: (selector: string) => selector === 'nav a[aria-label="Profile"]' ? { getAttribute: () => '/postline_test' } : null,
      querySelectorAll: (selector: string) => selector.includes('[data-navigation-stop]') ? [article] : [],
    } as unknown as Document
    expect(inspectXPage(document, 'https://x.com/postline_test', 'metrics')).toEqual({
      state: 'connected',
      handle: 'postline_test',
      measurements: [{ id: '2126032940035445011', counts: { replies: 1926, reposts: 2051 } }],
    })
  })

  test('stops at login and account checks even when the account sidebar is still mounted', () => {
    const document = {
      querySelector: (selector: string) => selector.includes('Profile_Link') ? { getAttribute: () => '/postline_test' } : null,
      querySelectorAll: () => { throw new Error('Reading posts at a sign-in gate') },
    } as unknown as Document
    expect(inspectXPage(document, 'https://x.com/i/flow/login', 'metrics')).toEqual({ state: 'signed-out' })
    const redirected = 'https://x.com/i/jf/onboarding/web?redirect_after_login=%2Fi%2Fchat&mode=login'
    expect(inspectXPage(document, redirected, 'metrics')).toEqual({ state: 'signed-out' })
    expect(inspectXPage(document, 'https://example.test/i/jf/onboarding/web?mode=login')).toEqual({ state: 'unavailable' })
    expect(inspectXPage(document, 'https://x.com/login', 'listening')).toEqual({ state: 'signed-out' })
    expect(inspectXPage(document, 'https://x.com/account/access/', 'metrics')).toEqual({ state: 'needs-attention' })
    expect(inspectXPage(document, 'https://x.com/account/accessibility')).toMatchObject({ state: 'connected' })
  })

  test('reads rendered search and mention posts on the expected X pages', () => {
    const stamp = '2026-11-27T05:00:00.000Z'
    const article = (href: string, visible = true) => ({
      getClientRects: () => visible ? [1] : [],
      querySelector(selector: string) {
        if (selector === 'time') return { getAttribute: () => stamp, closest: () => ({ getAttribute: () => href }) }
        if (selector.includes('tweetText')) return { innerText: 'Postline launch watch' }
        return null
      },
    })
    const document = {
      querySelector: (selector: string) => selector.includes('Profile_Link') ? { getAttribute: () => '/postline_test' } : null,
      querySelectorAll: (selector: string) => selector.includes('primaryColumn')
        ? [article('/another_user/status/42'), article('/hidden/status/43', false), article('https://example.test/foreign/status/44')]
        : [],
    } as unknown as Document
    const posts = [{ id: '42', authorHandle: 'another_user', body: 'Postline launch watch', postedAt: stamp }]
    expect(inspectXPage(document, 'https://x.com/search?q=postline', 'listening')).toMatchObject({ state: 'connected', posts })
    expect(inspectXPage(document, 'https://x.com/notifications/mentions', 'listening')).toMatchObject({ state: 'connected', posts })
    expect(inspectXPage(document, 'https://x.com/home', 'listening')).not.toHaveProperty('posts')
    expect(inspectXPage(document, 'https://x.com/account/access', 'listening')).toEqual({ state: 'needs-attention' })
  })

  test('imports matching posts once for active browser watches and skips paid API scans', async () => {
    const ids: number[] = []
    const tag = 'PostlineBrowserFixture' + crypto.randomUUID().replaceAll('-', '')
    const input = { name: tag, providers: ['twitter'], keywords: [tag, 'launch'], matchMode: 'all' }
    try {
      const browser = await keywordMonitoring.save(0, { ...input, twitterReadSource: 'browser' })
      ids.push(browser.id)
      const api = await keywordMonitoring.save(0, input)
      ids.push(api.id)
      const paused = await keywordMonitoring.save(0, { ...input, status: 'paused', twitterReadSource: 'browser' })
      ids.push(paused.id)
      const unrelated = await keywordMonitoring.save(0, { ...input, providers: ['bluesky'], twitterReadSource: 'browser' })
      ids.push(unrelated.id)
      expect(browser.twitterReadSource).toBe('browser')
      expect(api.twitterReadSource).toBe('api')
      expect(await keywordMonitoring.scan(browser.id)).toEqual({ scanned: 0, found: 0, created: 0, errors: [] })

      const post = { id: '17482', authorHandle: 'fixture_author', body: `${tag} launch`, postedAt: '2026-11-27T05:00:00.000Z' }
      const posts = [post, { ...post, id: '17483', body: tag }, { ...post, id: '17484', authorHandle: 'invalid handle' }]
      const imports = await Promise.all([keywordMonitoring.importTwitterBrowserPosts(posts), keywordMonitoring.importTwitterBrowserPosts(posts)])
      expect(imports.reduce((total, item) => total + item.created, 0)).toBe(1)
      const found = (await keywordMonitoring.list(browser.id)).mentions
      expect(found).toHaveLength(1)
      expect(found[0]).toMatchObject({
        provider: 'twitter', remoteUri: post.id, authorHandle: post.authorHandle, matchedKeywords: [tag, 'launch'],
        url: 'https://x.com/fixture_author/status/17482',
      })
      for (const id of [api.id, paused.id, unrelated.id])
        expect((await keywordMonitoring.list(id)).mentions).toHaveLength(0)
      const [alert] = await db.unsafe('SELECT body FROM alerts WHERE dedupe_key = ?', [`keyword:${browser.id}:twitter:${post.id}`])
      expect(alert?.body).toBe('Review the X results in Listening.')
    }
    finally {
      for (const id of ids) {
        await db.unsafe('DELETE FROM alerts WHERE dedupe_key LIKE ?', [`keyword:${id}:%`])
        await keywordMonitoring.remove(id)
      }
    }
  })

  test('stores visible counts only for matching published posts from the confirmed user', async () => {
    const previous = await twitterBrowserSession()
    const postIds: number[] = []
    const identities: number[] = []
    async function published(handle: string, remoteId: string, metrics: object) {
      const identity = await upsertIdentityRow('twitter', { handle }, {
        handle, auth_status: 'connected', access_token: 'fixture-session',
      })
      const id = Number(identity.id)
      identities.push(id)
      const { postId } = await postQueue.save({ text: 'X browser session measurement', providers: [`twitter:${id}`] })
      postIds.push(postId)
      await db.unsafe('UPDATE post_targets SET status = ?, remote_uri = ?, metrics = ? WHERE post_id = ?', ['published', remoteId, JSON.stringify(metrics), postId])
      return postId
    }
    async function metrics(postId: number) {
      const [target] = await db.unsafe('SELECT metrics FROM post_targets WHERE post_id = ?', [postId])
      return JSON.parse(String(target?.metrics))
    }

    try {
      await rememberTwitterBrowserHandle('postline_test')
      const own = await published('Postline_Test', '51', { likes: 9, views: 15 })
      const foreign = await published('other_user', '52', { likes: 8 })
      const observed = [
        { id: '51', counts: { likes: 0, text: 'untrusted', views: -1 } },
        { id: '52', counts: { likes: 2 } },
      ]
      await expect(saveTwitterBrowserMetrics('other_user', observed)).rejects.toThrow('Check the X browser sign-in')
      expect(await saveTwitterBrowserMetrics('postline_test', observed)).toBe(1)
      expect(await metrics(own)).toMatchObject({ likes: 0, views: 15 })
      expect(await metrics(own)).not.toHaveProperty('text')
      expect(await metrics(foreign)).toEqual({ likes: 8 })

      const writes = await Promise.all([
        saveTwitterBrowserMetrics('postline_test', [{ id: '51', counts: { replies: 3 } }]),
        saveTwitterBrowserMetrics('postline_test', [{ id: '51', counts: { reposts: 2 } }]),
      ])
      expect(writes).toEqual([1, 1])
      expect(await metrics(own)).toMatchObject({ likes: 0, views: 15, replies: 3, reposts: 2 })
      expect((await twitterBrowserSession()).profile).toBe(previous.profile)
    }
    finally {
      for (const id of postIds) {
        await db.unsafe('DELETE FROM post_targets WHERE post_id = ?', [id])
        await db.unsafe('DELETE FROM posts WHERE id = ?', [id])
      }
      for (const id of identities) await db.unsafe('DELETE FROM social_identities WHERE id = ?', [id])
      await rememberTwitterBrowserHandle(previous.handle)
    }
  })
})
