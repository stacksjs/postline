import { describe, expect, test } from 'bun:test'
import { createToken, revokeTokenById } from '@stacksjs/auth'
import { authCookieName } from '@stacksjs/auth/cookie'
import { db } from '@stacksjs/database'
import { featureTest } from '@stacksjs/testing'
import { createPostToken, postTokens, revokePostToken } from '../../app/Support/Automation/tokens'
import User from '../../storage/framework/defaults/app/Models/User'

const endpoint = '/api/postline/v1/posts'

async function ownerId() {
  const owner = await User.first() ?? await User.create({
    name: 'Automation Test',
    email: 'automation-owner@postline.test',
    password: 'not-used-for-authentication',
  })
  return Number(owner.id)
}

function submit(token: string, key: string = crypto.randomUUID()) {
  return featureTest().withHeaders({ authorization: `Bearer ${token}`, 'idempotency-key': key })
}

interface Receipt {
  data: { postId: number, status: string, scheduledAt: string | null }
}

describe('Postline automation API', () => {
  test('requires the post scope and cannot turn a scoped token into a browser session', async () => {
    const id = await ownerId()
    const scoped = await createPostToken(id, 'Draft robot', 1)
    const session = await createToken(id, 'Browser', ['*'], { withRefreshToken: false })
    const draft = { text: 'Draft for automation tests', providers: ['blog'] }
    try {
      ;(await featureTest().post(endpoint, draft)).assertStatus(401)
      ;(await submit(session.plainTextToken).post(endpoint, draft)).assertStatus(403)
      ;(await featureTest().withHeaders({ cookie: `${authCookieName()}=${scoped.plainTextToken}` }).post(endpoint, draft)).assertStatus(401)
      ;(await submit(scoped.plainTextToken).get('/api/postline/inbox')).assertStatus(403)
      ;(await submit(scoped.plainTextToken).post('/api/logout-all', {})).assertStatus(403)
      ;(await featureTest().withHeaders({ cookie: `${authCookieName()}=${scoped.plainTextToken}` }).get('/api/postline/queue')).assertStatus(403)
      ;(await submit(session.plainTextToken).get('/api/postline/queue')).assertStatus(200)
      expect((await postTokens(id)).map(token => token.id)).toContain(scoped.accessToken.id)
      await expect(revokePostToken(id, session.accessToken.id)).rejects.toThrow('No active Postline automation token')
      await revokePostToken(id, scoped.accessToken.id)
      ;(await submit(scoped.plainTextToken).post(endpoint, draft)).assertStatus(401)
    }
    finally {
      await revokeTokenById(session.accessToken.id)
      await revokeTokenById(scoped.accessToken.id)
    }
  })

  test('durably deduplicates concurrent submissions, and validates every target', async () => {
    const token = await createPostToken(await ownerId(), 'Schedule robot', 1)
    const key = crypto.randomUUID()
    const scheduledAt = new Date(Date.now() + 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z')
    const post = { text: 'A scheduled post from automation', title: 'Automation test', providers: ['blog'], scheduledAt }
    let created: number | undefined
    try {
      ;(await submit(token.plainTextToken).post(endpoint, { ...post, providers: ['blog', 'typo'] })).assertStatus(422)
      ;(await submit(token.plainTextToken).post(endpoint, { ...post, providers: ['blog:42'] })).assertStatus(422)
      ;(await submit(token.plainTextToken).post(endpoint, { ...post, scheduledAt: '2030-02-30T00:00:00Z' })).assertStatus(422)
      const responses = await Promise.all([
        submit(token.plainTextToken, key).post(endpoint, post),
        submit(token.plainTextToken, key).post(endpoint, post),
      ])
      for (const response of responses) response.assertStatus(201)
      const first = (await responses[0]!.json<Receipt>()).data
      created = first.postId
      expect(first.status).toBe('scheduled')
      expect((await responses[1]!.json<Receipt>()).data).toEqual(first)
      const replay = await submit(token.plainTextToken, key).post(endpoint, post)
      expect((await replay.json<Receipt>()).data).toEqual(first)
      ;(await submit(token.plainTextToken, key).post(endpoint, { ...post, text: 'A changed post' })).assertStatus(409)
      const stored = await db.selectFrom('posts').select(['body', 'source']).where('id', '=', created).executeTakeFirstOrThrow()
      expect(stored).toEqual({ body: post.text, source: 'api' })
      const targets = await db.selectFrom('post_targets').select('provider').where('post_id', '=', created).execute()
      expect(targets.map(target => target.provider)).toEqual(['blog'])

      await db.deleteFrom('post_targets').where('post_id', '=', created).execute()
      await db.deleteFrom('posts').where('id', '=', created).execute()
      const afterRemoval = await submit(token.plainTextToken, key).post(endpoint, post)
      expect((await afterRemoval.json<Receipt>()).data).toEqual(first)
      expect(await db.selectFrom('posts').select('id').where('body', '=', post.text).execute()).toEqual([])
    }
    finally {
      if (created) {
        await db.deleteFrom('post_targets').where('post_id', '=', created).execute()
        await db.deleteFrom('posts').where('id', '=', created).execute()
      }
      const keyHash = new Bun.CryptoHasher('sha256').update(key).digest('hex')
      await db.deleteFrom('post_submissions').where('request_key', '=', keyHash).execute()
      await revokeTokenById(token.accessToken.id)
    }
  })
})
