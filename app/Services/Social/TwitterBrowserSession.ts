import type { EngagementCounts } from '../../Support/Social/engagement-analytics'
import { release } from 'node:os'
import process from 'node:process'
import { db, sqliteWriteOptions } from '@stacksjs/database'
import { isDesktopAgent } from '../../Support/Auth/native'
import { UserFacingError } from '../../Support/Http/user-error'
import { workspaceXBrowserErrors, workspaceXBrowserSessionText } from '../../Support/Localization/workspace'
import type { PublicAccount } from '../../Support/Social/accounts'
import { toPublicAccount } from '../../Support/Social/accounts'
import { engagementCounts } from '../../Support/Social/engagement-analytics'
import { alerts } from '../AlertService'
import { saveTargetEngagement } from './save-target-engagement'
import { ensureAccount, now, uuid } from './support'

type ComposerHealth = 'ready' | 'layout' | 'unavailable' | 'attention'
const COMPOSER_CHECK_INTERVAL = 86_400_000

export interface TwitterBrowserSessionSnapshot {
  profile: string
  handle: string | null
  needsCheck: boolean
  needsLayoutCheck: boolean
  listeningNeedsAttention: boolean
  composerHealth: ComposerHealth | null
}

export async function twitterBrowserSession(): Promise<TwitterBrowserSessionSnapshot> {
  const account = await db.selectFrom('accounts')
    .select(['uuid', 'twitter_browser_handle', 'twitter_browser_needs_check', 'twitter_browser_needs_layout_check', 'twitter_browser_listening_attention', 'twitter_browser_composer_status', 'twitter_browser_composer_attempted_at', 'twitter_browser_composer_claim'])
    .where('id', '=', await ensureAccount()).executeTakeFirstOrThrow()
  return {
    profile: `postline-x-${account.uuid}`,
    handle: account.twitter_browser_handle ?? null,
    needsCheck: Boolean(account.twitter_browser_needs_check),
    needsLayoutCheck: Boolean(account.twitter_browser_needs_layout_check),
    listeningNeedsAttention: Boolean(account.twitter_browser_listening_attention),
    composerHealth: account.twitter_browser_composer_status === 'ready'
      && (account.twitter_browser_composer_claim || !account.twitter_browser_composer_attempted_at || account.twitter_browser_composer_attempted_at <= composerCheckCutoff())
      ? null
      : account.twitter_browser_composer_status ?? null,
  }
}

export async function localTwitterProfileForErasure(): Promise<string | null> {
  // Named WKWebsiteDataStore profiles were introduced with macOS 14 (Darwin 23).
  return supportsLocalTwitterBrowser() ? (await twitterBrowserSession()).profile : null
}

export function supportsLocalTwitterBrowser(): boolean {
  return isDesktopAgent() && process.platform === 'darwin' && Number(release().split('.')[0]) >= 23
}

export async function twitterBrowserPublishingAccounts(): Promise<PublicAccount[]> {
  if (!supportsLocalTwitterBrowser()) return []
  const session = await twitterBrowserSession()
  if (!session.handle) return []
  const selected = await db.selectFrom('social_identities')
    .select(['id', 'provider', 'handle', 'auth_status', 'display_name'])
    .where('account_id', '=', await ensureAccount()).where('provider', '=', 'twitter').where('auth_transport', '=', 'browser')
    .where('handle', '=', session.handle.toLowerCase()).where('auth_status', '=', 'connected').executeTakeFirst()
  if (!selected) return []
  return [{
    ...toPublicAccount({ ...selected, id: Number(selected.id) }),
    authStatus: 'connected',
    connected: true,
    canPublish: true,
    transport: 'browser',
  }]
}

export async function rememberTwitterBrowserHandle(handle: unknown, { checkedLayout = false } = {}): Promise<void> {
  if (handle !== null && (typeof handle !== 'string' || !/^[A-Za-z0-9_]{1,15}$/.test(handle)))
    throw new UserFacingError(workspaceXBrowserErrors.invalidHandle)

  const accountId = await ensureAccount()
  const at = now()
  const database = db as any
  await database.transaction((tx: typeof database) => {
    const save = tx.updateTable('accounts').set({
      twitter_browser_handle: handle,
      twitter_browser_needs_check: false,
      twitter_browser_needs_layout_check: false,
      twitter_browser_listening_attention: false,
      twitter_browser_composer_attempted_at: null,
      twitter_browser_composer_claim: null,
      twitter_browser_composer_status: null,
      updated_at: at,
    }).where('id', '=', accountId)
    const confirmed = (handle !== null && !checkedLayout
      ? save.where('twitter_browser_needs_layout_check', '=', false)
      : save).returning(['id']).executeTakeFirst()
    if (!confirmed) throw new UserFacingError(workspaceXBrowserErrors.checkLayout)
    tx.updateTable('keyword_monitors').set({ twitter_browser_claim: null }).where('account_id', '=', accountId)
      .where('twitter_browser_claim', 'is not', null).execute()
    if (!supportsLocalTwitterBrowser()) return

    const name = handle?.toLowerCase()
    const identities = () => tx.selectFrom('social_identities').select('id')
      .where('account_id', '=', accountId).where('provider', '=', 'twitter').where('auth_transport', '=', 'browser')
    const expire = tx.updateTable('social_identities').set({ auth_status: 'expired', updated_at: at })
      .where('account_id', '=', accountId).where('provider', '=', 'twitter').where('auth_transport', '=', 'browser')
      .where('auth_status', '=', 'connected')
    const oldIdentities = name ? expire.where('handle', '!=', name) : expire
    oldIdentities.execute()
    if (!name) return
    const existing = identities().where('handle', '=', name).executeTakeFirst()
    if (existing) {
      tx.updateTable('social_identities').set({ auth_status: 'connected', updated_at: at }).where('id', '=', existing.id).execute()
    }
    else {
      tx.insertInto('social_identities').values({
        uuid: uuid(), provider: 'twitter', handle: name, auth_transport: 'browser', auth_status: 'connected', is_default: false,
        account_id: accountId, created_at: at, updated_at: at,
      }).execute()
    }
  }, sqliteWriteOptions())
}

export async function pauseTwitterBrowserReads(reason: 'sign-in' | 'layout' | 'signed-out' | 'composer' | 'listening' = 'sign-in', expectedHandle?: string): Promise<void> {
  const layout = reason === 'layout'
  const pause = db.updateTable('accounts')
    .set({
      twitter_browser_needs_check: true,
      ...(layout ? { twitter_browser_needs_layout_check: true } : {}),
      ...(reason === 'composer' ? { twitter_browser_composer_status: 'attention' } : {}),
      ...(reason === 'listening' ? { twitter_browser_listening_attention: true } : {}),
      updated_at: now(),
    })
    .where('id', '=', await ensureAccount())
    .where(layout ? 'twitter_browser_needs_layout_check' : 'twitter_browser_needs_check', '=', false)
  // Seeing an ordinary sign-in page is expected before the first connection.
  const scope = expectedHandle ? pause.where('twitter_browser_handle', '=', expectedHandle)
    : reason === 'signed-out' ? pause.where('twitter_browser_handle', 'is not', null) : pause
  const account = await scope.returning(['uuid']).executeTakeFirst()
  if (!account) return

  await raiseBrowserAlert(account.uuid, layout)
}

async function raiseBrowserAlert(accountUuid: string, layout: boolean): Promise<void> {
  await alerts.raise({
    kind: 'account-expired',
    title: layout ? workspaceXBrowserSessionText.layoutTitle : workspaceXBrowserSessionText.attentionTitle,
    body: layout ? workspaceXBrowserSessionText.layout : workspaceXBrowserSessionText.attentionBody,
    link: '/accounts',
    key: `x-browser-attention:${accountUuid}:${now().slice(0, 10)}${layout ? ':layout' : ''}`,
  })
}

function composerCheckCutoff(): string {
  return new Date(Date.now() - COMPOSER_CHECK_INTERVAL).toISOString().slice(0, 19).replace('T', ' ')
}

export async function claimTwitterBrowserComposerCheck(): Promise<{ token: string, profile: string, handle: string } | null> {
  const token = uuid()
  const [account] = await db.unsafe(`
    UPDATE accounts
    SET twitter_browser_composer_attempted_at = ?, twitter_browser_composer_claim = ?
    WHERE id = ? AND twitter_browser_handle IS NOT NULL AND COALESCE(twitter_browser_needs_check, 0) = 0
      AND (twitter_browser_composer_attempted_at IS NULL OR twitter_browser_composer_attempted_at <= ?)
    RETURNING uuid, twitter_browser_handle
  `, [now(), token, await ensureAccount(), composerCheckCutoff()]) as Array<{ uuid: string, twitter_browser_handle: string }>
  return account?.twitter_browser_handle
    ? { token, profile: `postline-x-${account.uuid}`, handle: account.twitter_browser_handle }
    : null
}

export async function finishTwitterBrowserComposerCheck(token: unknown, health: unknown): Promise<boolean> {
  if (typeof token !== 'string' || !/^[0-9a-f-]{36}$/.test(token)
    || (health !== 'ready' && health !== 'layout' && health !== 'unavailable' && health !== 'attention'))
    throw new UserFacingError(workspaceXBrowserErrors.invalidComposerCheck)

  const account = await db.updateTable('accounts').set({
    twitter_browser_composer_claim: null,
    twitter_browser_composer_status: health,
    ...(health === 'attention' && { twitter_browser_needs_check: true }),
  }).where('id', '=', await ensureAccount())
    .where('twitter_browser_composer_claim', '=', token)
    .returning(['uuid']).executeTakeFirst()
  if (!account) return false

  if (health === 'attention') await raiseBrowserAlert(account.uuid, false)
  if (health === 'layout') await raiseComposerLayoutAlert(account.uuid)
  return true
}

export async function recordTwitterBrowserComposerMismatch(handle: string): Promise<void> {
  const account = await db.updateTable('accounts').set({
    twitter_browser_composer_status: 'layout',
  }).where('id', '=', await ensureAccount())
    .where('twitter_browser_handle', '=', handle)
    .returning(['uuid']).executeTakeFirst()
  if (account) await raiseComposerLayoutAlert(account.uuid)
}

async function raiseComposerLayoutAlert(accountUuid: string): Promise<void> {
  await alerts.raise({
    kind: 'account-expired',
    title: workspaceXBrowserSessionText.composerLayoutTitle,
    body: workspaceXBrowserSessionText.composerLayout,
    link: '/accounts',
    key: `x-browser-composer:${accountUuid}:${now().slice(0, 10)}`,
  })
}

export async function requireTwitterBrowserHandle(handle: unknown): Promise<string> {
  const session = await twitterBrowserSession()
  if (session.needsLayoutCheck) throw new UserFacingError(workspaceXBrowserErrors.checkLayout)
  if (session.needsCheck || !session.handle || typeof handle !== 'string' || handle.toLowerCase() !== session.handle.toLowerCase())
    throw new UserFacingError(workspaceXBrowserErrors.checkSignIn)
  return session.handle
}

export async function saveTwitterBrowserMetrics(handle: unknown, reports: unknown): Promise<number> {
  const confirmedHandle = await requireTwitterBrowserHandle(handle)
  if (!Array.isArray(reports) || reports.length > 100)
    throw new UserFacingError(workspaceXBrowserErrors.invalidMetrics)

  const measurements = new Map<string, EngagementCounts>()
  for (const report of reports) {
    if (typeof report?.id !== 'string' || !/^[0-9]{1,19}$/.test(report.id)) continue
    const counts = engagementCounts(report.counts)
    if (Object.keys(counts).length) measurements.set(report.id, counts)
  }
  if (!measurements.size) return 0

  const targets = await db.selectFrom('post_targets')
    .innerJoin('social_identities', 'social_identities.id', '=', 'post_targets.social_identity_id')
    .select(['post_targets.id', 'post_targets.remote_uri', 'post_targets.social_identity_id', 'social_identities.handle'])
    .where('post_targets.provider', '=', 'twitter')
    .where('post_targets.status', '=', 'published')
    .where('post_targets.remote_uri', 'in', [...measurements.keys()])
    .execute()

  const syncedAt = now()
  let synced = 0
  for (const target of targets) {
    if (typeof target.handle !== 'string' || target.handle.toLowerCase() !== confirmedHandle.toLowerCase()
      || typeof target.remote_uri !== 'string' || typeof target.social_identity_id !== 'number') continue
    const counts = measurements.get(target.remote_uri)
    if (counts && await saveTargetEngagement({ id: Number(target.id), identityId: target.social_identity_id, uri: target.remote_uri }, counts, syncedAt))
      synced++
  }
  return synced
}
