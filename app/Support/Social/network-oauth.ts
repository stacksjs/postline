import type { RequestInstance } from '@stacksjs/types'
import type { AppNetwork } from '../../Services/NetworkAppService'
import type { NetworkAuthorization } from './native-network-consent'
import { response } from '@stacksjs/router'
import { clearOAuthFlowCookie, consumeOAuthFlow, issueOAuthFlow, readOAuthFlowCookie } from '@stacksjs/socials'
import { allowsNativeAppWithoutLogin } from '../Auth/native'
import { publicMessage } from '../Http/action-error'
import { workspaceNetworkConsentText as copy } from '../Localization/workspace'
import { finishNativeNetworkConsent, nativeConsentIsActive, nativeNetworkConsentPage, NETWORK_CONSENT_TTL_MS, networkConsentPurpose } from './native-network-consent'

export interface NetworkOAuthExchangeOptions {
  codeVerifier?: string
  testOnly?: boolean
  requestedScopes?: string[]
}

function networkResult(provider: AppNetwork, status: 'connected' | 'tested' | 'error', message?: string): Response {
  const query = new URLSearchParams({ [provider]: status })
  if (message) query.set('message', message)
  return networkOAuthRedirect(`/accounts?${query}`)
}

export function networkOAuthRedirect(location: string, cookie?: string | null): Response {
  const headers = new Headers({
    'Location': location,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  })
  if (cookie) headers.append('Set-Cookie', cookie)
  return new Response(null, { status: 302, headers })
}

export async function workspaceOwner(request: RequestInstance): Promise<number | null | undefined> {
  if (allowsNativeAppWithoutLogin()) return null
  const user = await request.user()
  return user ? Number(user.id) : undefined
}

export async function redirectToNetworkConsent(
  request: RequestInstance,
  provider: AppNetwork,
  prepare: () => Promise<NetworkAuthorization>,
): Promise<Response> {
  const owner = await workspaceOwner(request)
  if (owner === undefined) return response.unauthorized('Unauthorized')
  if (owner === null) return networkResult(provider, 'error', copy.startInApp)

  try {
    const { url, codeVerifier, requestedScopes } = await prepare()
    const testOnly = request.get('test') === '1'
    const authorization = new URL(url)
    const flow = await issueOAuthFlow({
      purpose: networkConsentPurpose(provider, false),
      userId: owner,
      ttlMs: NETWORK_CONSENT_TTL_MS,
      data: { ...(testOnly && { testOnly }), ...(codeVerifier && { codeVerifier }), ...(requestedScopes && { requestedScopes }) },
      cookie: { path: `/api/postline/${provider}/callback` },
    })
    // The driver prepares its authorization parameters, including PKCE. The
    // flow store owns the state that ties those parameters to this browser.
    authorization.searchParams.set('state', flow.state)
    return networkOAuthRedirect(authorization.toString(), flow.cookie)
  }
  catch (error) {
    return networkResult(provider, 'error', publicMessage(error, copy.failed))
  }
}

export async function finishNetworkConsent(
  request: RequestInstance,
  provider: AppNetwork,
  exchange: (code: string, options: NetworkOAuthExchangeOptions, owner: number | null) => Promise<unknown>,
): Promise<Response> {
  const owner = await workspaceOwner(request)
  if (owner === undefined) return response.unauthorized('Unauthorized')

  const state = String(request.get('state') || '')
  const native = owner === null
  const cookie = { path: `/api/postline/${provider}/callback`, ...(native && { secure: false }) }
  let nativeConsentId: string | undefined
  let result: Response
  try {
    const flow = await consumeOAuthFlow(state, {
      purpose: networkConsentPurpose(provider, native),
      browserSecret: readOAuthFlowCookie(request.headers.get('cookie'), state),
    })
    if (!flow || flow.userId !== owner) {
      result = networkResult(provider, 'error', copy.wrongBrowser)
    }
    else {
      if (native) {
        const id = flow.data?.nativeConsentId
        if (!nativeConsentIsActive(id, provider)) return nativeNetworkConsentPage(400)
        nativeConsentId = id
      }
      const code = String(request.get('code') || '')
      if (request.get('error')) {
        result = networkResult(provider, 'error', copy.denied)
      }
      else if (!code) {
        result = networkResult(provider, 'error', copy.missingCode)
      }
      else {
        const codeVerifier = typeof flow.data?.codeVerifier === 'string' ? flow.data.codeVerifier : undefined
        const testOnly = flow.data?.testOnly === true
        const requestedScopes = Array.isArray(flow.data?.requestedScopes) ? flow.data.requestedScopes.filter((scope): scope is string => typeof scope === 'string') : undefined
        const exchanged = await exchange(code, { codeVerifier, testOnly, ...(requestedScopes && { requestedScopes }) }, owner)
        result = exchanged instanceof Response ? exchanged : networkResult(provider, testOnly ? 'tested' : 'connected')
      }
    }
  }
  catch (error) {
    result = networkResult(provider, 'error', publicMessage(error, copy.failed))
  }
  if (native) {
    if (nativeConsentId) finishNativeNetworkConsent(nativeConsentId, result)
    result = nativeNetworkConsentPage(nativeConsentId ? 200 : 400)
  }
  if (/^[a-f0-9]{64}$/.test(state)) result.headers.append('Set-Cookie', await clearOAuthFlowCookie(state, cookie))
  return result
}
