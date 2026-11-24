/**
 * The owner's developer app on each OAuth network: where its client id and
 * secret come from, and the address the network sends the owner back to.
 *
 * Settings win over the environment. The environment still works, so an
 * install configured through `.env` keeps working, but nothing needs it:
 * the Mac app reads no `.env`, and could not connect these networks at all.
 */
import process from 'node:process'
import { db } from '@stacksjs/database'
import { UserFacingError } from '../Support/Http/user-error'
import { openToken, sealToken } from '../Support/Social/token-vault'
import { now } from './Social/support'

const database = db as any

export type AppNetwork = 'twitter' | 'linkedin' | 'instagram' | 'threads'
export const APP_NETWORKS: readonly AppNetwork[] = ['twitter', 'linkedin', 'instagram', 'threads']

const ENV_PREFIX: Record<AppNetwork, string> = { twitter: 'TWITTER', linkedin: 'LINKEDIN', instagram: 'INSTAGRAM', threads: 'THREADS' }

export interface NetworkAppCredentials {
  clientId: string
  clientSecret: string
  redirectUrl: string
  /** Where the id and secret came from. */
  source: 'settings' | 'environment' | 'none'
}

/** What Settings shows: never the secret, only whether there is one. */
export interface NetworkAppSummary {
  provider: AppNetwork
  configured: boolean
  source: NetworkAppCredentials['source']
  clientId: string
  hasSecret: boolean
  redirectUrl: string
}

/** This install's public origin, from APP_URL (the Mac app sets it to its own address). */
function appOrigin(): string {
  const raw = String(process.env.APP_URL || '').trim().replace(/\/+$/, '')
  if (!raw) return 'http://localhost:3008'
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
}

/** The callback address the network must be told about, unless one was set. */
export function defaultRedirectUrl(network: AppNetwork, origin: string = appOrigin()): string {
  return `${origin.replace(/\/+$/, '')}/api/postline/${network}/callback`
}

export class NetworkAppService {
  async credentials(network: AppNetwork): Promise<NetworkAppCredentials> {
    const row = await database.selectFrom('network_apps').selectAll().where('provider', '=', network).executeTakeFirst()
    const env = (name: string): string => String(process.env[`${ENV_PREFIX[network]}_${name}`] || '').trim()

    if (row?.client_id) {
      return {
        clientId: String(row.client_id),
        clientSecret: (await openToken(row.client_secret)) || '',
        redirectUrl: String(row.redirect_url || '').trim() || env('REDIRECT_URL') || defaultRedirectUrl(network),
        source: 'settings',
      }
    }
    const clientId = env('CLIENT_ID')
    return {
      clientId,
      clientSecret: env('CLIENT_SECRET'),
      redirectUrl: env('REDIRECT_URL') || defaultRedirectUrl(network),
      source: clientId ? 'environment' : 'none',
    }
  }

  async summary(): Promise<NetworkAppSummary[]> {
    return await Promise.all(APP_NETWORKS.map(async (provider) => {
      const credentials = await this.credentials(provider)
      return {
        provider,
        configured: Boolean(credentials.clientId && credentials.clientSecret),
        source: credentials.source,
        clientId: credentials.clientId,
        hasSecret: Boolean(credentials.clientSecret),
        redirectUrl: credentials.redirectUrl,
      }
    }))
  }

  /**
   * Store a network's app. A blank secret keeps the stored one, so the id can
   * be corrected without pasting the secret again.
   */
  async save(network: AppNetwork, input: { clientId: string, clientSecret?: string, redirectUrl?: string }): Promise<NetworkAppSummary> {
    if (!APP_NETWORKS.includes(network)) throw new UserFacingError('That network does not use an app of its own.')
    const clientId = input.clientId.trim()
    if (!clientId || clientId.length > 255 || /\s/.test(clientId)) throw new UserFacingError('Paste the client id from the network\'s developer console. It has no spaces.')
    const secret = String(input.clientSecret ?? '').trim()
    if (secret && (secret.length > 1000 || /\s/.test(secret))) throw new UserFacingError('Paste the client secret exactly as the console shows it. It has no spaces.')
    const redirectUrl = String(input.redirectUrl ?? '').trim()
    if (redirectUrl && !/^https?:\/\/[^\s]+$/i.test(redirectUrl)) throw new UserFacingError('The redirect address must start with http:// or https://.')

    const existing = await database.selectFrom('network_apps').selectAll().where('provider', '=', network).executeTakeFirst()
    if (!secret && !existing?.client_secret) throw new UserFacingError('Paste the client secret as well. Postline needs both to connect.')

    const values = {
      client_id: clientId,
      ...(secret ? { client_secret: await sealToken(secret) } : {}),
      redirect_url: redirectUrl || null,
      updated_at: now(),
    }
    if (existing)
      await database.updateTable('network_apps').set(values).where('id', '=', existing.id).execute()
    else
      await database.insertInto('network_apps').values({ provider: network, ...values, created_at: now() }).execute()

    return (await this.summary()).find(entry => entry.provider === network)!
  }

  /** Forget a network's stored app; the environment, if set, applies again. */
  async clear(network: AppNetwork): Promise<void> {
    await database.deleteFrom('network_apps').where('provider', '=', network).execute()
  }
}

export const networkApps = new NetworkAppService()
