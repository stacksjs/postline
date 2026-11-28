import type { EngagementCounts } from '../../Support/Social/engagement-analytics'
import { release } from 'node:os'
import process from 'node:process'
import { db } from '@stacksjs/database'
import { isDesktopAgent } from '../../Support/Auth/native'
import { UserFacingError } from '../../Support/Http/user-error'
import { workspaceXBrowserErrors, workspaceXBrowserSessionText } from '../../Support/Localization/workspace'
import { engagementCounts } from '../../Support/Social/engagement-analytics'
import { alerts } from '../AlertService'
import { saveTargetEngagement } from './save-target-engagement'
import { ensureAccount, now } from './support'

export interface TwitterBrowserSessionSnapshot {
  profile: string
  handle: string | null
  needsCheck: boolean
  needsLayoutCheck: boolean
}

export async function twitterBrowserSession(): Promise<TwitterBrowserSessionSnapshot> {
  const account = await db.selectFrom('accounts').select(['uuid', 'twitter_browser_handle', 'twitter_browser_needs_check', 'twitter_browser_needs_layout_check'])
    .where('id', '=', await ensureAccount()).executeTakeFirstOrThrow()
  return {
    profile: `postline-x-${account.uuid}`,
    handle: account.twitter_browser_handle ?? null,
    needsCheck: Boolean(account.twitter_browser_needs_check),
    needsLayoutCheck: Boolean(account.twitter_browser_needs_layout_check),
  }
}

export async function localTwitterProfileForErasure(): Promise<string | null> {
  // Named WKWebsiteDataStore profiles were introduced with macOS 14 (Darwin 23).
  const canHaveLocalProfile = isDesktopAgent() && process.platform === 'darwin'
    && Number(release().split('.')[0]) >= 23
  return canHaveLocalProfile ? (await twitterBrowserSession()).profile : null
}

export async function rememberTwitterBrowserHandle(handle: unknown, { checkedLayout = false } = {}): Promise<void> {
  if (handle !== null && (typeof handle !== 'string' || !/^[A-Za-z0-9_]{1,15}$/.test(handle)))
    throw new UserFacingError(workspaceXBrowserErrors.invalidHandle)

  const save = db.updateTable('accounts').set({
    twitter_browser_handle: handle,
    twitter_browser_needs_check: false,
    twitter_browser_needs_layout_check: false,
    updated_at: now(),
  }).where('id', '=', await ensureAccount())
  const confirmed = await (handle !== null && !checkedLayout
    ? save.where('twitter_browser_needs_layout_check', '=', false)
    : save).returning(['id']).executeTakeFirst()
  if (!confirmed) throw new UserFacingError(workspaceXBrowserErrors.checkLayout)
}

export async function pauseTwitterBrowserReads(reason: 'sign-in' | 'layout' = 'sign-in'): Promise<void> {
  const layout = reason === 'layout'
  const account = await db.updateTable('accounts')
    .set({
      twitter_browser_needs_check: true,
      ...(layout ? { twitter_browser_needs_layout_check: true } : {}),
      updated_at: now(),
    })
    .where('id', '=', await ensureAccount())
    .where(layout ? 'twitter_browser_needs_layout_check' : 'twitter_browser_needs_check', '=', false)
    .returning(['uuid']).executeTakeFirst()
  if (!account) return

  await alerts.raise({
    kind: 'account-expired',
    title: layout ? workspaceXBrowserSessionText.layoutTitle : workspaceXBrowserSessionText.attentionTitle,
    body: layout ? workspaceXBrowserSessionText.layout : workspaceXBrowserSessionText.attentionBody,
    link: '/accounts',
    key: `x-browser-attention:${account.uuid}:${now().slice(0, 10)}${layout ? ':layout' : ''}`,
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
