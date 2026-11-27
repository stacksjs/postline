import { describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { postQueue } from '../../app/Services/Social/QueueService'
import { rememberTwitterBrowserHandle, saveTwitterBrowserMetrics, twitterBrowserSession } from '../../app/Services/Social/TwitterBrowserSession'
import { upsertIdentityRow } from '../../app/Services/Social/identities'
import { inspectXPage } from '../../resources/functions/x-browser-session'

describe('X session browser reads', () => {
  test('captures measured zero and exact text counts from the owner’s rendered posts', () => {
    const control = (textContent: string, label = '') => ({
      textContent,
      getAttribute: () => label,
      getClientRects: () => [1],
    })
    const article = (handle: string) => ({
      getClientRects: () => [1],
      querySelector(selector: string) {
        if (selector === 'time') return { closest: () => ({ getAttribute: () => `/${handle}/status/42` }) }
        if (selector.includes('"like"')) return control('', '0 Likes. Like')
        if (selector.includes('"reply"')) return control('1.2K')
        if (selector.includes('analytics')) return control('1,440')
        return null
      },
    })
    const document = {
      querySelector: (selector: string) => selector.includes('Profile_Link') ? { getAttribute: () => '/postline_test' } : null,
      querySelectorAll: () => [article('postline_test'), article('another_user')],
    } as unknown as Document
    expect(inspectXPage(document, 'https://x.com/postline_test', true)).toEqual({
      state: 'connected',
      handle: 'postline_test',
      measurements: [{ id: '42', counts: { likes: 0, views: 1440 } }],
    })
    expect(inspectXPage(document, 'https://x.com/account/access', true)).toEqual({ state: 'needs-attention' })
    expect(inspectXPage(document, 'https://example.test/postline_test', true)).toEqual({ state: 'unavailable' })
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
