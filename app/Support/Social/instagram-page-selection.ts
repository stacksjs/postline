import type { RequestInstance } from '@stacksjs/types'
import type { InstagramPageSelection } from '../../Services/Social/InstagramService'
import { timingSafeEqual } from 'node:crypto'
import { clearOAuthFlowCookie, consumeOAuthFlow, databaseOAuthFlowStore, issueOAuthFlow, oauthFlowDigest, readOAuthFlowCookie } from '@stacksjs/socials'
import { instagram } from '../../Services/Social/InstagramService'
import { UserFacingError } from '../Http/user-error'
import { networkOAuthRedirect } from './network-oauth'
import { isSealed, openToken, sealToken } from './token-vault'

const purpose = 'postline-connect:instagram-page'
const cookie = { path: '/api/postline/instagram/pages', sameSite: 'Strict' } as const

function expired(): UserFacingError {
  return new UserFacingError('This Instagram Page selection expired or was opened in another browser. Connect Instagram again from Channels.')
}

export async function stageInstagramPageSelection(owner: number | null, selection: InstagramPageSelection): Promise<Response> {
  const pages = selection.pages.map(({ pageId, pageName, username, igUserId }) => ({ pageId, pageName, username, igUserId }))
  const credentials = await sealToken(JSON.stringify(selection))
  const flow = await issueOAuthFlow({
    purpose,
    userId: owner,
    ttlMs: 10 * 60_000,
    cookie,
    data: { pages, credentials },
  })
  const query = new URLSearchParams({ instagram: 'choose', instagram_state: flow.state })
  return networkOAuthRedirect(`/accounts?${query}`, flow.cookie)
}

async function pendingSelection(request: RequestInstance, owner: number | null) {
  const state = request.get('state')
  if (typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state)) throw expired()
  const secret = readOAuthFlowCookie(request.headers.get('cookie'), state)
  if (!secret) throw expired()

  // The preview is read-only. The framework's atomic consume is the only
  // path that can take the credentials and connect a Page.
  const record = await databaseOAuthFlowStore().find(oauthFlowDigest(state))
  const digest = oauthFlowDigest(secret)
  if (!record || record.purpose !== purpose || record.userId !== owner || record.expiresAt <= new Date()
    || !record.browserDigest || record.browserDigest.length !== digest.length
    || !timingSafeEqual(Buffer.from(record.browserDigest), Buffer.from(digest))
    || !Array.isArray(record.data?.pages)) throw expired()

  return { state, secret, pages: record.data.pages as Array<Pick<InstagramPageSelection['pages'][number], 'pageId' | 'pageName' | 'username' | 'igUserId'>> }
}

export async function previewInstagramPageSelection(request: RequestInstance, owner: number | null) {
  return (await pendingSelection(request, owner)).pages
}

export async function finishInstagramPageSelection(request: RequestInstance, owner: number | null): Promise<Response> {
  const { state, secret, pages } = await pendingSelection(request, owner)
  const pageId = request.get('page_id')
  const cancelled = request.get('cancel') === true
  if (!cancelled && (typeof pageId !== 'string' || !pages.some(page => page.pageId === pageId)))
    throw new UserFacingError('Choose a Facebook Page from the list Meta authorized.')

  const flow = await consumeOAuthFlow(state, { purpose, browserSecret: secret })
  if (!flow || flow.userId !== owner) throw expired()
  const headers = { 'Cache-Control': 'no-store', 'Set-Cookie': await clearOAuthFlowCookie(state, cookie) }
  if (cancelled) return Response.json({ ok: true, data: null }, { headers })

  const credentials = flow.data?.credentials
  if (!isSealed(credentials)) throw expired()
  const selection = JSON.parse((await openToken(credentials))!) as InstagramPageSelection
  const page = selection.pages.find(account => account.pageId === pageId)
  if (!page) throw expired()

  const account = await instagram.connectAuthorizedPage(page, selection.insightsAccessToken)
  return Response.json({ ok: true, data: account }, { headers })
}
