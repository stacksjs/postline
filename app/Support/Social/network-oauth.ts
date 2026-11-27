import type { RequestInstance } from '@stacksjs/types'
import type { AppNetwork } from '../../Services/NetworkAppService'
import { response } from '@stacksjs/router'
import { clearOAuthFlowCookie, consumeOAuthFlow, issueOAuthFlow, readOAuthFlowCookie } from '@stacksjs/socials'
import { allowsNativeAppWithoutLogin } from '../Auth/native'
import { publicMessage } from '../Http/action-error'

const FLOW_TTL_MS = 15 * 60_000

function networkResult(provider: AppNetwork, message?: string): Response {
  const query = new URLSearchParams({ [provider]: message ? 'error' : 'connected' })
  if (message) query.set('message', message)
  return redirect(`/accounts?${query}`)
}

function redirect(location: string, cookie?: string | null): Response {
  const headers = new Headers({
    'Location': location,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  })
  if (cookie) headers.append('Set-Cookie', cookie)
  return new Response(null, { status: 302, headers })
}

async function workspaceOwner(request: RequestInstance): Promise<number | null | undefined> {
  if (allowsNativeAppWithoutLogin()) return null
  const user = await request.user()
  return user ? Number(user.id) : undefined
}

export async function redirectToNetworkConsent(
  request: RequestInstance,
  provider: AppNetwork,
  prepare: () => Promise<{ url: string, codeVerifier?: string }>,
): Promise<Response> {
  const owner = await workspaceOwner(request)
  if (owner === undefined) return response.unauthorized('Unauthorized')

  try {
    const { url, codeVerifier } = await prepare()
    const authorization = new URL(url)
    const flow = await issueOAuthFlow({
      purpose: `postline-connect:${provider}`,
      userId: owner,
      ttlMs: FLOW_TTL_MS,
      data: codeVerifier ? { codeVerifier } : undefined,
      cookie: { path: `/api/postline/${provider}/callback` },
    })
    // The driver prepares its authorization parameters, including PKCE. The
    // flow store owns the state that ties those parameters to this browser.
    authorization.searchParams.set('state', flow.state)
    return redirect(authorization.toString(), flow.cookie)
  }
  catch (error) {
    return networkResult(provider, publicMessage(error))
  }
}

export async function finishNetworkConsent(
  request: RequestInstance,
  provider: AppNetwork,
  exchange: (code: string, codeVerifier?: string) => Promise<unknown>,
): Promise<Response> {
  const owner = await workspaceOwner(request)
  if (owner === undefined) return response.unauthorized('Unauthorized')

  const state = String(request.get('state') || '')
  let result: Response
  try {
    const flow = await consumeOAuthFlow(state, {
      purpose: `postline-connect:${provider}`,
      browserSecret: readOAuthFlowCookie(request.headers.get('cookie'), state),
    })
    if (!flow || flow.userId !== owner) {
      result = networkResult(provider, 'This connection expired or was started in another browser. Start again from Channels.')
    }
    else if (request.get('error')) {
      result = networkResult(provider, 'The network did not authorize the connection. Try connecting again from Channels.')
    }
    else {
      const code = String(request.get('code') || '')
      const verifier = typeof flow.data?.codeVerifier === 'string' ? flow.data.codeVerifier : undefined
      await exchange(code, verifier)
      result = networkResult(provider)
    }
  }
  catch (error) {
    result = networkResult(provider, publicMessage(error))
  }
  if (state) result.headers.append('Set-Cookie', await clearOAuthFlowCookie(state, { path: `/api/postline/${provider}/callback` }))
  return result
}
