/**
 * Every connected social account, across networks.
 *
 * The per-network services each own their accounts (connecting, refreshing,
 * publishing); this is the one place that sees them side by side, for the
 * Accounts page and anything else that lists or disconnects an account by id
 * without knowing which network it is on.
 */

import type { PublicAccount } from '../../Support/Social/accounts'
import type { SocialProvider } from '../../Support/Social/types'
import { db } from '@stacksjs/database'
import { ACCOUNT_PROVIDERS } from '../../Support/Social/targets'
import { bluesky } from './BlueskyService'
import { instagram } from './InstagramService'
import { linkedin } from './LinkedInService'
import { mastodon } from './MastodonService'
import { threads } from './ThreadsService'
import { twitter } from './TwitterService'

const database = db as any

interface AccountOwner {
  listAccounts: () => Promise<PublicAccount[]>
  disconnect: (identityId: number) => Promise<PublicAccount>
}

const owners: Partial<Record<SocialProvider, AccountOwner>> = {
  bluesky,
  twitter,
  mastodon,
  linkedin,
  instagram,
  threads,
}

export class AccountService {
  /** All connected (not disconnected) accounts, grouped by network in display order. */
  async list(): Promise<PublicAccount[]> {
    const lists = await Promise.all(ACCOUNT_PROVIDERS.map(provider => owners[provider]?.listAccounts() ?? []))
    return lists.flat()
  }

  /**
   * Disconnect one account by id. The owning network is looked up rather than
   * trusted from the request, so a stale or forged provider cannot route the
   * id to the wrong service.
   */
  async disconnect(identityId: number): Promise<PublicAccount> {
    const row = await database
      .selectFrom('social_identities')
      .select(['id', 'provider', 'auth_status'])
      .where('id', '=', identityId)
      .executeTakeFirst()

    if (!row || row.auth_status === 'revoked') throw new Error('That account is not connected.')

    const owner = owners[row.provider as SocialProvider]
    if (!owner) throw new Error(`${row.provider} accounts cannot be disconnected here.`)

    return await owner.disconnect(Number(row.id))
  }
}

export const accounts = new AccountService()
