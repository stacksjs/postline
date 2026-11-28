import { db, sqliteWriteOptions } from '@stacksjs/database'
import { UserFacingError } from '../../Support/Http/user-error'
import { xBrowserPostId } from '../../Support/Social/x-browser-write'
import { ensureAccount, now, uuid } from './support'
import { pauseTwitterBrowserReads } from './TwitterBrowserSession'

const database = db as any

function connectedAccount(tx: typeof database, accountId: number) {
  const account = tx.selectFrom('accounts').select(['uuid', 'twitter_browser_handle', 'twitter_browser_needs_check', 'twitter_browser_needs_layout_check'])
    .where('id', '=', accountId).executeTakeFirst()
  if (!account?.twitter_browser_handle || account.twitter_browser_needs_check || account.twitter_browser_needs_layout_check)
    throw new UserFacingError('Check sign-in with the original X browser account in Channels.')
  return { handle: String(account.twitter_browser_handle).toLowerCase(), profile: `postline-x-${account.uuid}` }
}

function publishedTarget(tx: typeof database, targetId: number, accountId: number) {
  const session = connectedAccount(tx, accountId)
  const target = tx.selectFrom('post_targets').innerJoin('posts', 'posts.id', '=', 'post_targets.post_id')
    .select(['post_targets.post_id', 'post_targets.remote_uri', 'post_targets.social_identity_id', 'post_targets.archived_account', 'posts.thread_key'])
    .where('post_targets.id', '=', targetId).where('post_targets.provider', '=', 'twitter')
    .where('post_targets.status', '=', 'published').where('posts.account_id', '=', accountId)
    .where('posts.status', '=', 'published').executeTakeFirst()
  if (!xBrowserPostId(target?.remote_uri)) throw new UserFacingError('This target has no published X post to delete.')
  const identity = target.social_identity_id
    ? tx.selectFrom('social_identities').select(['handle', 'auth_transport']).where('id', '=', target.social_identity_id)
      .where('provider', '=', 'twitter').where('auth_status', '!=', 'revoked').executeTakeFirst()
    : null
  const archived = target.archived_account ? JSON.parse(target.archived_account) : null
  const browserHandle = target.social_identity_id
    ? identity?.auth_transport === 'browser' ? identity.handle : null
    : archived?.provider === 'twitter' && archived.transport === 'browser' ? archived.handle : null
  if (typeof browserHandle !== 'string' || browserHandle.toLowerCase() !== session.handle)
    throw new UserFacingError('Check sign-in with the original X browser account in Channels.')
  if (target.thread_key && tx.selectFrom('thread_publish_claims').select('id').where('thread_key', '=', target.thread_key).executeTakeFirst())
    throw new UserFacingError('Wait for the thread to finish publishing before deleting this X post.')

  const receipt = tx.selectFrom('twitter_browser_dispatches').select(['uuid', 'delete_token', 'deleted_at'])
    .where('post_id', '=', target.post_id).where('handle', '=', session.handle)
    .where('state', '=', 'published').where('remote_id', '=', target.remote_uri).executeTakeFirst()
  if (!receipt || receipt.deleted_at) throw new UserFacingError('This X post is unavailable or already deleted.')
  if (receipt.delete_token) throw new UserFacingError('X did not confirm the previous deletion. Check the post on X.')
  return { ...session, id: target.remote_uri, receipt: String(receipt.uuid) }
}

export const twitterBrowserDelete = {
  async prepare(targetId: number) {
    const accountId = await ensureAccount()
    return await database.transaction((tx: typeof database) => publishedTarget(tx, targetId, accountId))
  },

  async authorize(targetId: number, receipt: unknown) {
    const accountId = await ensureAccount()
    return await database.transaction((tx: typeof database) => {
      const target = publishedTarget(tx, targetId, accountId)
      if (target.receipt !== receipt) throw new UserFacingError('This X post changed. Check the post again before deleting it.')
      const token = uuid()
      const granted = tx.updateTable('twitter_browser_dispatches').set({ delete_token: token, updated_at: now() })
        .where('uuid', '=', target.receipt).where('delete_token', 'is', null).where('deleted_at', 'is', null)
        .returning('uuid').executeTakeFirst()
      return granted ? token : null
    }, sqliteWriteOptions())
  },

  async attention(targetId: number, receipt: unknown) {
    const target = await this.prepare(targetId)
    if (target.receipt !== receipt) return false
    await pauseTwitterBrowserReads('composer', target.handle)
    return true
  },

  async result(token: unknown, state: unknown) {
    if (typeof token !== 'string' || !/^[0-9a-f-]{36}$/.test(token)
      || (state !== 'deleted' && state !== 'refused' && state !== 'attention' && state !== 'uncertain'))
      throw new UserFacingError('Postline could not read the X deletion result.')
    const accountId = await ensureAccount()
    const recorded = await database.transaction((tx: typeof database) => {
      const attempt = tx.selectFrom('twitter_browser_dispatches').innerJoin('posts', 'posts.id', '=', 'twitter_browser_dispatches.post_id')
        .select(['twitter_browser_dispatches.uuid', 'twitter_browser_dispatches.handle'])
        .where('twitter_browser_dispatches.delete_token', '=', token).where('posts.account_id', '=', accountId)
        .where('twitter_browser_dispatches.deleted_at', 'is', null).executeTakeFirst()
      if (!attempt) return null
      if (state === 'deleted' || state === 'refused') {
        const at = now()
        tx.updateTable('twitter_browser_dispatches').set({
          delete_token: null, ...(state === 'deleted' && { deleted_at: at }), updated_at: at,
        }).where('uuid', '=', attempt.uuid).execute()
      }
      return attempt
    }, sqliteWriteOptions())
    if (recorded && state === 'attention') await pauseTwitterBrowserReads('composer', recorded.handle)
    return Boolean(recorded)
  },
}
