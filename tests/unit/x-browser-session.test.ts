import { describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { keywordMonitoring } from '../../app/Services/KeywordMonitoringService'
import { postQueue } from '../../app/Services/Social/QueueService'
import { rememberTwitterBrowserHandle, saveTwitterBrowserMetrics, twitterBrowserSession } from '../../app/Services/Social/TwitterBrowserSession'
import { upsertIdentityRow } from '../../app/Services/Social/identities'
import { ensureAccount } from '../../app/Services/Social/support'
import { inspectXPage, removeXBrowserProfile } from '../../resources/functions/x-browser-session'
import { inspectXComposer } from '../../resources/assets/scripts/x-composer-health'

test('profile removal succeeds when no X window has ever opened', async () => {
  const calls: string[] = []
  const host = { window: {
    async _call() { throw Object.assign(new Error('Invalid parameter value'), { code: 'INVALID_PARAMETER' }) },
    async removeDataStore(name: string) { calls.push(name) },
  } }

  expect(await removeXBrowserProfile(host, 'unused-x-store')).toBe('removed')
  expect(calls).toEqual(['unused-x-store'])
})

test('profile removal still reports busy when another view owns the store', async () => {
  const calls: string[] = []
  const host = { window: {
    async _call(action: string, _input: undefined, name: string) {
      calls.push(`${action}:${name}`)
      throw Object.assign(new Error('The named X window is absent.'), { code: 'INVALID_PARAMETER' })
    },
    async removeDataStore(name: string) {
      calls.push(`remove:${name}`)
      throw Object.assign(new Error('WebKit still holds this profile.'), { code: 'BUSY' })
    },
  } }

  expect(await removeXBrowserProfile(host, 'x-store')).toBe('busy')
  expect(calls).toEqual(['remove:x-store', 'getState:x-store', 'getState:x-store-composer', 'getState:x-store-listening', 'remove:x-store'])
})

test('X Composer health verifies the account and supported controls without submitting', () => {
  const href = 'https://x.com/compose/post'
  const visible = { getClientRects: () => [1] }
  const attachment = {}
  const page = (media: boolean, loading = false) => ({
    readyState: 'complete',
    querySelector(selector: string) {
      if (selector.includes('Profile_Link')) return { getAttribute: () => '/postline_test' }
      if (selector === '[role="progressbar"]') return loading ? {} : null
      if (selector === '[role="dialog"]') return {
        querySelector: (control: string) => control.includes('fileInput') ? (media ? attachment : null) : visible,
      }
      return null
    },
  }) as unknown as Document
  expect(inspectXComposer(page(true), href, 'Postline_Test')).toBe('ready')
  expect(inspectXComposer(page(false), href, 'postline_test')).toBe('layout')
  expect(inspectXComposer(page(false, true), href, 'postline_test')).toBe('unavailable')
  expect(inspectXComposer(page(true), href, 'different')).toBe('attention')
  expect(inspectXComposer(page(true), 'https://x.com/account/access', 'postline_test')).toBe('attention')
  expect(inspectXComposer(page(true), 'https://example.test/compose/post', 'postline_test')).toBe('unavailable')
})

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
      querySelector(selector: string) {
        if (selector.includes('Profile_Link')) return { getAttribute: () => '/postline_test' }
        return selector.includes('primaryColumn') ? {
          querySelectorAll: () => [article('/another_user/status/42'), article('/hidden/status/43', false), article('https://example.test/foreign/status/44')],
        } : null
      },
    } as unknown as Document
    const posts = [{ id: '42', authorHandle: 'another_user', body: 'Postline launch watch', postedAt: stamp }]
    expect(inspectXPage(document, 'https://x.com/search?q=postline', 'listening')).toMatchObject({ state: 'connected', posts })
    expect(inspectXPage(document, 'https://x.com/notifications/mentions', 'listening')).toMatchObject({ state: 'connected', posts })
    expect(inspectXPage(document, 'https://x.com/home', 'listening')).not.toHaveProperty('posts')
    expect(inspectXPage(document, 'https://x.com/search?q=postline&f=live', 'listening', 'postline')).toMatchObject({ posts })
    expect(inspectXPage(document, 'https://x.com/search?q=postline', 'listening', 'postline')).toMatchObject({ readIssue: 'layout' })
    expect(inspectXPage(document, 'https://x.com/search?q=other&f=live', 'listening', 'postline')).toMatchObject({ readIssue: 'layout' })
    expect(inspectXPage(document, 'https://x.com/account/access', 'listening')).toEqual({ state: 'needs-attention' })
  })

  test('reads the exact open post from the signed-in profile for reconciliation', () => {
    const postedAt = '2026-11-27T05:00:00.000Z'
    const detail = (id: string, author = 'postline_test', inner = false) => {
      const article = {
        getClientRects: () => [1],
        querySelector(selector: string) {
          if (selector === 'time') return {
            closest: (name: string) => name === 'article' ? inner ? {} : article : { getAttribute: () => `/${author}/status/${id}` },
            getAttribute: () => postedAt,
          }
          if (selector.includes('tweetText')) return {
            innerText: 'Postline example.org/hi…',
            closest: () => article,
            getClientRects: () => [1],
            querySelectorAll: () => [{ innerText: 'example.org/hi…', title: 'https://example.org/highlights' }],
          }
          return null
        },
      }
      return article
    }
    const page = {
      querySelector: (selector: string) => selector.includes('Profile_Link') ? { getAttribute: () => '/postline_test' } : null,
      querySelectorAll: () => [detail('42', 'other_user'), detail('42', 'postline_test', true), detail('43'), detail('42')],
    } as unknown as Document
    expect(inspectXPage(page, 'https://x.com/postline_test/status/42', 'post')).toMatchObject({
      state: 'connected', posts: [{ id: '42', authorHandle: 'postline_test', body: 'Postline https://example.org/highlights', postedAt }],
    })
    expect(inspectXPage(page, 'https://x.com/other_user/status/42', 'post')).not.toHaveProperty('posts')
    expect(inspectXPage(page, 'https://x.com/postline_test', 'post')).not.toHaveProperty('posts')
    expect(inspectXPage(page, 'https://x.com/postline_test/status/44', 'post')).toMatchObject({ posts: [] })
  })

  test('distinguishes an empty X timeline from one that cannot be read', () => {
    const page = (rows: { getClientRects: () => number[] }[] | null, empty = false) => ({
      querySelector(selector: string) {
        if (selector.includes('Profile_Link')) return { getAttribute: () => '/postline_test' }
        return selector.includes('primaryColumn') && rows ? {
          querySelector: (within: string) => empty && within.includes('emptyState') ? { getClientRects: () => [1] } : null,
          querySelectorAll: (within: string) => within === 'article' ? rows : [],
        } : null
      },
      querySelectorAll: () => [],
    }) as unknown as Document
    const search = 'https://x.com/search?q=postline'
    expect(inspectXPage(page(null), search, 'listening')).toMatchObject({ state: 'connected', readIssue: 'loading' })
    expect(inspectXPage(page([{ getClientRects: () => [1] }]), search, 'listening')).toMatchObject({ state: 'connected', readIssue: 'layout' })
    expect(inspectXPage(page([]), search, 'listening')).toMatchObject({ state: 'connected', readIssue: 'loading' })
    expect(inspectXPage(page([{ getClientRects: () => [] }], true), search, 'listening')).toEqual({
      state: 'connected', handle: 'postline_test', measurements: [], posts: [],
    })
  })

  test('reads Listening posts with a status link beside the article', () => {
    const stamp = '2026-11-27T05:00:00.000Z'
    const article = {
      parentElement: { querySelector: () => ({ getAttribute: () => '/fixture_author/status/42' }) },
      getClientRects: () => [1],
      querySelector(selector: string) {
        if (selector === 'time') return { getAttribute: () => stamp, closest: () => null }
        if (selector.includes('tweetText')) return { innerText: 'A visible mention' }
        return null
      },
    }
    const column = { querySelectorAll: (selector: string) => selector === 'article' || selector.includes('[data-navigation-stop] > article') ? [article] : [] }
    const document = {
      querySelector(selector: string) {
        if (selector.includes('Profile_Link')) return { getAttribute: () => '/postline_test' }
        return selector.includes('primaryColumn') ? column : null
      },
      querySelectorAll: () => [],
    } as unknown as Document

    expect(inspectXPage(document, 'https://x.com/notifications/mentions', 'listening')).toMatchObject({
      state: 'connected', posts: [{ id: '42', authorHandle: 'fixture_author', body: 'A visible mention', postedAt: stamp }],
    })
  })

  test('imports matching posts once for active browser watches and skips paid API scans', async () => {
    const ids: number[] = []
    const tag = crypto.randomUUID().replaceAll('-', '')
    const second = crypto.randomUUID().replaceAll('-', '')
    const input = { name: tag, providers: ['twitter'], keywords: [tag, second], matchMode: 'all' }
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

      const post = { id: '17482', authorHandle: 'fixture_author', body: `${tag} ${second}`, postedAt: '2026-11-27T05:00:00.000Z' }
      const posts = [post, { ...post, id: '17483', body: tag }, { ...post, id: '17484', authorHandle: 'invalid handle' }]
      const imports = await Promise.all([keywordMonitoring.importTwitterBrowserPosts(posts), keywordMonitoring.importTwitterBrowserPosts(posts)])
      expect(imports.reduce((total, item) => total + item.created, 0)).toBe(1)
      const found = (await keywordMonitoring.list(browser.id)).mentions
      expect(found).toHaveLength(1)
      expect(found[0]).toMatchObject({
        provider: 'twitter', remoteUri: post.id, authorHandle: post.authorHandle, matchedKeywords: [tag, second],
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

  test('paces background searches across runners and stores only results for the claimed watch', async () => {
    const [savedAccount] = await db.unsafe(`SELECT id, twitter_browser_handle, twitter_browser_needs_check, twitter_browser_needs_layout_check,
      twitter_browser_listening_attention, twitter_browser_listening_attempted_at, twitter_browser_composer_attempted_at,
      twitter_browser_composer_claim, twitter_browser_composer_status FROM accounts ORDER BY id LIMIT 1`)
    const accountId = await ensureAccount()
    const existingWatches = await db.selectFrom('keyword_monitors').select('id')
      .where('account_id', '=', accountId).where('twitter_browser_background', '=', true).execute()
    const ids: number[] = []
    const input = { name: 'X scheduled search fixture', providers: ['twitter'], keywords: ['browser scan fixture'], matchMode: 'all', twitterReadSource: 'browser' }
    const fixture = { id: '771701', authorHandle: 'fixture_author', body: 'A browser scan fixture', postedAt: '2026-11-27T05:00:00.000Z' }
    const resetInterval = () => db.updateTable('accounts').set({ twitter_browser_listening_attempted_at: null }).where('id', '=', accountId).execute()
    try {
      for (const { id } of existingWatches)
        await db.updateTable('keyword_monitors').set({ twitter_browser_background: false }).where('id', '=', id).execute()
      await rememberTwitterBrowserHandle('listen_fixture', { checkedLayout: true })
      const account = await twitterBrowserSession()
      resetInterval()
      const manual = await keywordMonitoring.save(0, input)
      ids.push(manual.id)
      expect(manual.twitterBrowserBackground).toBe(false)
      const paused = await keywordMonitoring.save(0, { ...input, status: 'paused', twitterBrowserBackground: true })
      ids.push(paused.id)
      expect(await keywordMonitoring.claimTwitterBrowserScan()).toBeNull()

      const first = await keywordMonitoring.save(0, { ...input, twitterBrowserBackground: true })
      const second = await keywordMonitoring.save(0, { ...input, twitterBrowserBackground: true })
      ids.push(first.id, second.id)
      const claims = await Promise.all([keywordMonitoring.claimTwitterBrowserScan(), keywordMonitoring.claimTwitterBrowserScan()])
      const claim = claims.find(work => work !== null)!
      expect(claims.filter(Boolean)).toHaveLength(1)
      expect(claim).toMatchObject({ profile: account.profile, handle: 'listen_fixture', query: '"browser scan fixture"' })
      expect(await keywordMonitoring.finishTwitterBrowserScan(claim.token, 'other_user', 'captured', [fixture])).toEqual({ recorded: false, created: 0 })
      expect(await keywordMonitoring.finishTwitterBrowserScan(claim.token, claim.handle, 'captured', [fixture])).toEqual({ recorded: true, created: 1 })
      expect(await keywordMonitoring.finishTwitterBrowserScan(claim.token, claim.handle, 'captured', [fixture])).toEqual({ recorded: false, created: 0 })
      expect(await keywordMonitoring.claimTwitterBrowserScan()).toBeNull()
      expect((await keywordMonitoring.list(first.id)).mentions).toHaveLength(1)
      for (const id of [manual.id, paused.id, second.id])
        expect((await keywordMonitoring.list(id)).mentions).toHaveLength(0)

      resetInterval()
      const obsolete = (await keywordMonitoring.claimTwitterBrowserScan())!
      await keywordMonitoring.save(second.id, { ...input, twitterBrowserBackground: false })
      expect(await keywordMonitoring.finishTwitterBrowserScan(obsolete.token, obsolete.handle, 'captured', [fixture])).toEqual({ recorded: false, created: 0 })
      expect((await keywordMonitoring.list(second.id)).mentions).toHaveLength(0)

      resetInterval()
      const challenged = (await keywordMonitoring.claimTwitterBrowserScan())!
      expect(await keywordMonitoring.finishTwitterBrowserScan(challenged.token, challenged.handle, 'attention', undefined)).toEqual({ recorded: true, created: 0 })
      expect(await twitterBrowserSession()).toMatchObject({ needsCheck: true, listeningNeedsAttention: true })
      resetInterval()
      expect(await keywordMonitoring.claimTwitterBrowserScan()).toBeNull()

      await rememberTwitterBrowserHandle('listen_fixture')
      const changedLayout = (await keywordMonitoring.claimTwitterBrowserScan())!
      expect(await keywordMonitoring.finishTwitterBrowserScan(changedLayout.token, changedLayout.handle, 'layout', undefined)).toEqual({ recorded: true, created: 0 })
      expect(await twitterBrowserSession()).toMatchObject({ needsCheck: true, needsLayoutCheck: true })
      expect(await keywordMonitoring.claimTwitterBrowserScan()).toBeNull()
    }
    finally {
      for (const id of ids) {
        await db.unsafe('DELETE FROM alerts WHERE dedupe_key LIKE ?', [`keyword:${id}:%`])
        await keywordMonitoring.remove(id)
      }
      for (const { id } of existingWatches)
        await db.updateTable('keyword_monitors').set({ twitter_browser_background: true }).where('id', '=', id).execute()
      const account = await twitterBrowserSession()
      await db.unsafe('DELETE FROM alerts WHERE dedupe_key LIKE ?', [`x-browser-attention:${account.profile.slice('postline-x-'.length)}:%`])
      if (savedAccount) {
        const { id, ...values } = savedAccount
        await (db as any).updateTable('accounts').set(values).where('id', '=', id).execute()
      }
      else {
        await rememberTwitterBrowserHandle(null, { checkedLayout: true })
        resetInterval()
      }
    }
  })

  test('settles a restored X receipt for its saved browser connection and variant', async () => {
    const accountId = await ensureAccount()
    const previous = await db.selectFrom('accounts').where('id', '=', accountId)
      .select(['twitter_browser_handle', 'twitter_browser_needs_check', 'twitter_browser_needs_layout_check']).executeTakeFirstOrThrow()
    const handle = 'restored_review'
    const stamp = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 19).replace('T', ' ')
    const postedAt = new Date(Date.now() - 86_400_000).toISOString()
    const ids: number[] = []
    let postId = 0
    try {
      await db.updateTable('accounts').set({
        twitter_browser_handle: handle, twitter_browser_needs_check: false, twitter_browser_needs_layout_check: false,
      }).where('id', '=', accountId).execute()
      for (const auth_transport of ['api', 'browser'] as const) {
        const identity = await db.insertInto('social_identities').values({
          uuid: crypto.randomUUID(), provider: 'twitter', handle, auth_transport, auth_status: 'connected', account_id: accountId,
        }).returning('id').executeTakeFirstOrThrow()
        ids.push(Number(identity.id))
      }
      const post = await db.insertInto('posts').values({
        uuid: crypto.randomUUID(), status: 'failed', body: 'Shared text',
        content: JSON.stringify({ variants: { twitter: 'The X-specific text' } }), account_id: accountId, created_at: stamp,
      }).returning('id').executeTakeFirstOrThrow()
      postId = Number(post.id)
      await db.insertInto('twitter_browser_dispatches').values({
        uuid: crypto.randomUUID(), post_id: post.id, handle, state: 'submitting', created_at: stamp,
      }).execute()
      const target = await db.insertInto('post_targets').values({
        uuid: crypto.randomUUID(), post_id: post.id, provider: 'twitter', status: 'failed',
        archived_account: JSON.stringify({ provider: 'twitter', handle, transport: 'browser' }), created_at: stamp,
      }).returning('id').executeTakeFirstOrThrow()

      const observed = { id: '32107814', authorHandle: handle, body: 'The X-specific text', postedAt }
      await expect(postQueue.linkXBrowserPost(Number(target.id), { ...observed, body: 'Shared text' })).rejects.toThrow('does not match')
      expect(await postQueue.linkXBrowserPost(Number(target.id), observed)).toEqual({ url: `https://x.com/${handle}/status/32107814` })
      const settled = await db.selectFrom('post_targets').select(['status', 'social_identity_id', 'archived_account'])
        .where('id', '=', target.id).executeTakeFirstOrThrow()
      expect(settled).toEqual({ status: 'published', social_identity_id: ids[1], archived_account: null })
    }
    finally {
      if (postId) {
        await db.deleteFrom('post_targets').where('post_id', '=', postId).execute()
        await db.deleteFrom('posts').where('id', '=', postId).execute()
      }
      for (const id of ids) await db.deleteFrom('social_identities').where('id', '=', id).execute()
      await db.updateTable('accounts').set(previous).where('id', '=', accountId).execute()
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
      await expect(rememberTwitterBrowserHandle('https://x.com/fixture')).rejects.toThrow('Postline could not identify the signed-in X account.')
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
