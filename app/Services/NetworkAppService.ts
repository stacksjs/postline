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
import { isDesktopAgent } from '../Support/Auth/native'
import { UserFacingError } from '../Support/Http/user-error'
import { openToken, sealToken } from '../Support/Social/token-vault'
import { now } from './Social/support'
import { twitterReadUsage } from './Social/TwitterReadBudget'

const database = db as any

export type AppNetwork = 'twitter' | 'linkedin' | 'instagram' | 'threads'
export const APP_NETWORKS: readonly AppNetwork[] = ['twitter', 'linkedin', 'instagram', 'threads']

const ENV_PREFIX: Record<AppNetwork, string> = { twitter: 'TWITTER', linkedin: 'LINKEDIN', instagram: 'INSTAGRAM', threads: 'THREADS' }

export interface NetworkAppCredentials {
  clientId: string
  clientSecret: string
  redirectUrl: string
  /** LinkedIn: connect the owner's company Pages as well (`LINKEDIN_PAGES=true` from the environment). */
  organizationPages: boolean
  engagementMetrics: boolean
  directMessages: boolean
  firstComments: boolean
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
  publicClient: boolean
  redirectUrl: string
  organizationPages: boolean
  engagementMetrics: boolean
  directMessages: boolean
  firstComments: boolean
  readUsage?: Awaited<ReturnType<typeof twitterReadUsage>>
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
    // An imported workspace may carry the callback of its previous host.
    // OAuth on the Mac always returns to this agent's own listener.
    const savedRedirect = row?.client_id ? String(row.redirect_url || '').trim() : ''
    const redirectUrl = isDesktopAgent() ? defaultRedirectUrl(network) : savedRedirect || env('REDIRECT_URL') || defaultRedirectUrl(network)

    if (row?.client_id) {
      return {
        clientId: String(row.client_id),
        clientSecret: (await openToken(row.client_secret)) || '',
        redirectUrl,
        organizationPages: network === 'linkedin' && Boolean(Number(row.organization_pages ?? 0)),
        engagementMetrics: Boolean(Number(row.engagement_metrics ?? 0)),
        directMessages: network === 'twitter' && Boolean(Number(row.direct_messages ?? 0)),
        firstComments: network === 'instagram' && Boolean(Number(row.first_comments ?? 0)),
        source: 'settings',
      }
    }
    const clientId = env('CLIENT_ID')
    return {
      clientId,
      clientSecret: env('CLIENT_SECRET'),
      redirectUrl,
      organizationPages: network === 'linkedin' && env('PAGES').toLowerCase() === 'true',
      engagementMetrics: env('ENGAGEMENT_METRICS').toLowerCase() === 'true',
      directMessages: network === 'twitter' && env('DIRECT_MESSAGES').toLowerCase() === 'true',
      firstComments: network === 'instagram' && env('FIRST_COMMENTS').toLowerCase() === 'true',
      source: clientId ? 'environment' : 'none',
    }
  }

  async summary(): Promise<NetworkAppSummary[]> {
    return await Promise.all(APP_NETWORKS.map(async (provider) => {
      const credentials = await this.credentials(provider)
      const publicClient = provider === 'twitter' && Boolean(credentials.clientId) && !credentials.clientSecret
      return {
        provider,
        configured: Boolean(credentials.clientId && (publicClient || credentials.clientSecret)),
        source: credentials.source,
        clientId: credentials.clientId,
        hasSecret: Boolean(credentials.clientSecret),
        publicClient,
        redirectUrl: credentials.redirectUrl,
        organizationPages: credentials.organizationPages,
        engagementMetrics: credentials.engagementMetrics,
        directMessages: credentials.directMessages,
        firstComments: credentials.firstComments,
        ...(provider === 'twitter' ? { readUsage: await twitterReadUsage() } : {}),
      }
    }))
  }

  /**
   * Store a network's app. A blank secret keeps the stored one, so the id can
   * be corrected without pasting the secret again.
   */
  async save(network: AppNetwork, input: { clientId: string, clientSecret?: string, publicClient?: boolean, redirectUrl?: string, organizationPages?: boolean, engagementMetrics?: boolean, directMessages?: boolean, firstComments?: boolean }): Promise<NetworkAppSummary> {
    if (!APP_NETWORKS.includes(network)) throw new UserFacingError('That network does not use an app of its own.')
    const clientId = input.clientId.trim()
    if (!clientId || clientId.length > 255 || /\s/.test(clientId)) throw new UserFacingError('Paste the client id from the network\'s developer console. It has no spaces.')
    const secret = String(input.clientSecret ?? '').trim()
    if (secret && (secret.length > 1000 || /\s/.test(secret))) throw new UserFacingError('Paste the client secret exactly as the console shows it. It has no spaces.')
    if (input.publicClient && network !== 'twitter') throw new UserFacingError('Saving a public client is only supported for X.')
    if (input.publicClient && secret) throw new UserFacingError('For a public X app, omit the client secret.')
    const redirectUrl = String(input.redirectUrl ?? '').trim()
    if (redirectUrl && !/^https?:\/\/[^\s]+$/i.test(redirectUrl)) throw new UserFacingError('The redirect address must start with http:// or https://.')

    const existing = await database.selectFrom('network_apps').selectAll().where('provider', '=', network).executeTakeFirst()
    const keepPublicClient = !secret && Boolean(existing?.client_id) && existing.client_secret === null
    const publicClient = network === 'twitter' && (input.publicClient ?? keepPublicClient)
    if (!publicClient && !secret && !existing?.client_secret) throw new UserFacingError('Paste the client secret as well. Postline needs both to connect.')

    const values = {
      client_id: clientId,
      ...(publicClient ? { client_secret: null } : secret ? { client_secret: await sealToken(secret) } : {}),
      redirect_url: redirectUrl || null,
      // Left as it is when not given, so a form without the switch keeps it.
      ...(input.organizationPages === undefined ? {} : { organization_pages: network === 'linkedin' && input.organizationPages }),
      ...(input.engagementMetrics === undefined ? {} : { engagement_metrics: input.engagementMetrics }),
      ...(network === 'twitter' && input.directMessages !== undefined ? { direct_messages: input.directMessages } : {}),
      ...(network === 'instagram' && input.firstComments !== undefined ? { first_comments: input.firstComments } : {}),
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
