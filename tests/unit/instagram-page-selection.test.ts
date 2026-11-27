import type { RequestInstance } from '@stacksjs/types'
import { expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { databaseOAuthFlowStore, oauthFlowDigest } from '@stacksjs/socials'
import { finishInstagramPageSelection, previewInstagramPageSelection, stageInstagramPageSelection } from '../../app/Support/Social/instagram-page-selection'
import { openToken } from '../../app/Support/Social/token-vault'

const owner = 7
const selection = {
  pages: [
    { pageId: '700', pageName: 'First Page', igUserId: '9001', username: 'first.page', pageAccessToken: 'private-first-page' },
    { pageId: '701', pageName: 'Second Page', igUserId: '9002', username: 'second.page', pageAccessToken: 'private-second-page' },
  ],
  insightsAccessToken: 'private-insights-token',
}

function request(state: string, cookie: string, fields: Record<string, unknown> = {}): RequestInstance {
  return {
    get: (key: string) => key === 'state' ? state : fields[key],
    headers: new Headers({ cookie }),
  } as unknown as RequestInstance
}

async function start() {
  const response = await stageInstagramPageSelection(owner, selection)
  const location = new URL(response.headers.get('Location')!, 'https://postline.example.test')
  expect(location.searchParams.get('instagram')).toBe('choose')
  const state = location.searchParams.get('instagram_state')!
  const cookie = response.headers.get('Set-Cookie')!
  expect(cookie).toContain('HttpOnly')
  expect(cookie).toContain('SameSite=Strict')
  expect(cookie).toContain('Path=/api/postline/instagram/pages')
  return { state, cookie: cookie.split(';')[0]! }
}

test('an Instagram Page must be selected from the authorized list by its owner and browser', async () => {
  const { state, cookie } = await start()
  const store = databaseOAuthFlowStore()
  try {
    const storedFlow = await store.find(oauthFlowDigest(state))
    expect(storedFlow?.data?.credentials).toStartWith('enc:v1:')
    expect(JSON.stringify(storedFlow)).not.toContain('private-')

    await expect(previewInstagramPageSelection(request(state, ''), owner)).rejects.toThrow('another browser')
    await expect(previewInstagramPageSelection(request(state, cookie), owner + 1)).rejects.toThrow('another browser')
    expect(await previewInstagramPageSelection(request(state, cookie), owner)).toEqual([
      { pageId: '700', pageName: 'First Page', igUserId: '9001', username: 'first.page' },
      { pageId: '701', pageName: 'Second Page', igUserId: '9002', username: 'second.page' },
    ])
    await expect(finishInstagramPageSelection(request(state, cookie, { page_id: '999' }), owner)).rejects.toThrow('from the list')

    const finish = () => finishInstagramPageSelection(request(state, cookie, { page_id: '701' }), owner)
    const attempts = await Promise.allSettled([finish(), finish()])
    expect(attempts.map(attempt => attempt.status).sort()).toEqual(['fulfilled', 'rejected'])
    const result = attempts.find(attempt => attempt.status === 'fulfilled')!
    expect(result.value.headers.get('Set-Cookie')).toContain('Max-Age=0')
    expect(await result.value.json()).toMatchObject({ ok: true, data: { handle: 'second.page', connected: true } })
    await expect(previewInstagramPageSelection(request(state, cookie), owner)).rejects.toThrow('expired')

    const rows = await db.unsafe(
      'SELECT external_id, instagram_page_id, access_token, insights_access_token FROM social_identities WHERE provider = ? AND external_id IN (?, ?)',
      ['instagram', '9001', '9002'],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ external_id: '9002', instagram_page_id: '701' })
    expect(rows[0]?.access_token).toStartWith('enc:v1:')
    expect(await openToken(String(rows[0]?.access_token))).toBe('private-second-page')
    expect(await openToken(String(rows[0]?.insights_access_token))).toBe('private-insights-token')
  }
  finally {
    await store.take(oauthFlowDigest(state))
    await db.unsafe('DELETE FROM social_identities WHERE provider = ? AND external_id IN (?, ?)', ['instagram', '9001', '9002'])
  }
})

test('cancelling consumes the choice without connecting a Page', async () => {
  const { state, cookie } = await start()
  const response = await finishInstagramPageSelection(request(state, cookie, { cancel: true }), owner)
  expect(await response.json()).toEqual({ ok: true, data: null })
  expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0')
  await expect(finishInstagramPageSelection(request(state, cookie, { page_id: '701' }), owner)).rejects.toThrow('expired')
})
