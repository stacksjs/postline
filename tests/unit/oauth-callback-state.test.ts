import type { RequestInstance } from '@stacksjs/types'
import type { AppNetwork } from '../../app/Services/NetworkAppService'
import { describe, expect, mock, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { oauthFlowDigest } from '@stacksjs/socials'
import { APP_NETWORKS } from '../../app/Services/NetworkAppService'
import { finishNetworkConsent, redirectToNetworkConsent } from '../../app/Support/Social/network-oauth'

function request(fields: Record<string, string> = {}, cookie = '', ownerId = 7): RequestInstance {
  return {
    get: (key: string) => fields[key],
    headers: new Headers({ cookie }),
    user: async () => ({ id: ownerId }),
  } as unknown as RequestInstance
}

async function start(provider: AppNetwork, codeVerifier?: string) {
  const reply = await redirectToNetworkConsent(request(), provider, async () => ({
    url: 'https://network.example/authorize?scope=publish',
    codeVerifier,
  }))
  expect(reply.status).toBe(302)
  expect(reply.headers.get('Cache-Control')).toBe('no-store')
  const location = new URL(reply.headers.get('Location')!)
  const state = location.searchParams.get('state')!
  const cookie = reply.headers.get('Set-Cookie')!
  expect(cookie).toContain('HttpOnly')
  expect(cookie).toContain(`Path=/api/postline/${provider}/callback`)
  expect(location.searchParams.get('scope')).toBe('publish')
  return { state, cookie: cookie.split(';')[0]! }
}

describe('network OAuth flow state', () => {
  test.each(APP_NETWORKS)('%s completes only a pending browser-bound flow', async (provider) => {
    const { state, cookie } = await start(provider)
    const exchange = mock<(code: string, verifier?: string) => Promise<void>>(async () => {})
    const fields = { code: 'test-code', state }
    const unbound = await finishNetworkConsent(request(fields), provider, exchange)
    expect(unbound.headers.get('Location')).toContain(`?${provider}=error`)
    expect(exchange).not.toHaveBeenCalled()

    const finished = await finishNetworkConsent(request(fields, cookie), provider, exchange)
    expect(finished.headers.get('Location')).toBe(`/accounts?${provider}=connected`)
    expect(finished.headers.get('Set-Cookie')).toContain('Max-Age=0')
    expect(exchange).toHaveBeenCalledTimes(1)
    expect(exchange).toHaveBeenCalledWith('test-code', undefined)

    const repeated = await finishNetworkConsent(request(fields, cookie), provider, exchange)
    expect(repeated.headers.get('Location')).toContain(`?${provider}=error`)
    expect(exchange).toHaveBeenCalledTimes(1)
  })

  test('keeps simultaneous PKCE flows separate in the database', async () => {
    const first = await start('twitter', 'first-verifier')
    const second = await start('twitter', 'second-verifier')
    const rows = await db.unsafe(
      'SELECT state_digest, user_id FROM oauth_flows WHERE state_digest IN (?, ?)',
      [oauthFlowDigest(first.state), oauthFlowDigest(second.state)],
    )
    expect(rows).toHaveLength(2)
    expect(rows.every(row => row.user_id === 7)).toBe(true)

    const exchange = mock<(code: string, verifier?: string) => Promise<void>>(async () => {})
    const one = await finishNetworkConsent(request({ code: 'one', state: first.state }, first.cookie), 'twitter', exchange)
    const two = await finishNetworkConsent(request({ code: 'two', state: second.state }, second.cookie), 'twitter', exchange)
    expect(one.headers.get('Location')).toBe('/accounts?twitter=connected')
    expect(two.headers.get('Location')).toBe('/accounts?twitter=connected')
    expect(exchange.mock.calls).toEqual([['one', 'first-verifier'], ['two', 'second-verifier']])
  })

  test('clears a cancelled flow and does not exchange a code', async () => {
    const { state, cookie } = await start('instagram')
    const exchange = mock(async () => {})
    const reply = await finishNetworkConsent(request({ state, error: 'access_denied' }, cookie), 'instagram', exchange)
    expect(reply.headers.get('Location')).toContain('?instagram=error')
    expect(reply.headers.get('Set-Cookie')).toContain('Max-Age=0')
    expect(exchange).not.toHaveBeenCalled()
  })

  test('confines a consent flow to its network and signed-in owner', async () => {
    const { state, cookie } = await start('linkedin')
    const exchange = mock(async () => {})
    const fields = { state, code: 'test-code' }
    const otherNetwork = await finishNetworkConsent(request(fields, cookie), 'threads', exchange)
    expect(otherNetwork.headers.get('Location')).toContain('?threads=error')
    const otherOwner = await finishNetworkConsent(request(fields, cookie, 8), 'linkedin', exchange)
    expect(otherOwner.headers.get('Location')).toContain('?linkedin=error')
    expect(exchange).not.toHaveBeenCalled()
  })
})
