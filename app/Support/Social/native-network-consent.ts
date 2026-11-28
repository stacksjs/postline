import type { AppNetwork } from '../../Services/NetworkAppService'
import { randomBytes } from 'node:crypto'
import process from 'node:process'
import { issueOAuthFlow } from '@stacksjs/socials'
import { defaultRedirectUrl } from '../../Services/NetworkAppService'
import { UserFacingError } from '../Http/user-error'

export const NATIVE_NETWORK_CONSENT = '/api/postline/desktop-network-consent'
export const NETWORK_CONSENT_TTL_MS = 15 * 60_000

export interface NetworkAuthorization {
  url: string
  codeVerifier?: string
  requestedScopes?: string[]
}

interface PendingConsent {
  provider: AppNetwork
  authorization: NetworkAuthorization
  testOnly: boolean
  expiresAt: number
  launched: boolean
  result?: Response
}

// These handoff results belong to the current agent launch. The browser's
// callback proof is stored separately by the framework's OAuth flow store.
const pending = new Map<string, PendingConsent>()

export function networkConsentPurpose(provider: AppNetwork, native: boolean): string {
  return native ? `postline-desktop-connect:${provider}` : `postline-connect:${provider}`
}

function activeConsent(id: unknown): PendingConsent | undefined {
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) return
  const entry = pending.get(id)
  if (entry && entry.expiresAt > Date.now()) return entry
  pending.delete(id)
}

export function beginNativeNetworkConsent(provider: AppNetwork, authorization: NetworkAuthorization, testOnly: boolean) {
  const redirect = new URL(authorization.url).searchParams.get('redirect_uri')
  const origin = new URL(process.env.APP_URL || '')
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || redirect !== defaultRedirectUrl(provider, origin.origin))
    throw new UserFacingError('Register the redirect address shown in Postline Channels for this Mac and try again.')

  const now = Date.now()
  for (const [id, entry] of pending) {
    if (entry.expiresAt <= now) pending.delete(id)
  }
  const id = randomBytes(32).toString('hex')
  pending.set(id, { provider, authorization, testOnly, expiresAt: now + NETWORK_CONSENT_TTL_MS, launched: false })
  const launchUrl = new URL(`${NATIVE_NETWORK_CONSENT}/launch`, origin)
  launchUrl.searchParams.set('ticket', id)
  return { id, launchUrl: launchUrl.href }
}

export async function launchNativeNetworkConsent(ticket: unknown) {
  const entry = activeConsent(ticket)
  if (!entry || entry.launched) return
  entry.launched = true
  const { provider, authorization, testOnly } = entry
  const flow = await issueOAuthFlow({
    purpose: networkConsentPurpose(provider, true),
    ttlMs: entry.expiresAt - Date.now(),
    data: { nativeConsentId: ticket, testOnly, codeVerifier: authorization.codeVerifier, requestedScopes: authorization.requestedScopes },
    cookie: { path: `/api/postline/${provider}/callback`, secure: false },
  })
  const url = new URL(authorization.url)
  url.searchParams.set('state', flow.state)
  return { url: url.href, cookie: flow.cookie }
}

export function nativeConsentIsActive(id: unknown, provider: AppNetwork): id is string {
  const entry = activeConsent(id)
  return entry?.provider === provider && entry.launched && !entry.result
}

export function finishNativeNetworkConsent(id: string, result: Response): void {
  const entry = activeConsent(id)
  if (entry) entry.result = result
}

export function nativeNetworkConsentResult(id: unknown): Response {
  const entry = activeConsent(id)
  const headers = new Headers({ 'Cache-Control': 'no-store' })
  if (!entry) return Response.json({ ok: true, data: { state: 'expired' } }, { headers })
  if (!entry.result) return Response.json({ ok: true, data: { state: 'pending' } }, { headers })

  const location = entry.result.headers.get('Location')
  // For Instagram, the existing Page-selection response issues a cookie.
  // Deliver it only to Postline, including if the first result read was lost.
  const cookie = entry.result.headers.get('Set-Cookie')
  if (cookie) headers.set('Set-Cookie', cookie)
  return Response.json({ ok: true, data: { state: 'complete', location } }, { headers })
}

export function nativeNetworkConsentPage(status: 200 | 400): Response {
  return new Response(status === 200
    ? 'Return to Postline to finish connecting. You can close this tab.'
    : 'This connection expired or was started in another browser. Start again from Postline Channels.', {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  })
}
