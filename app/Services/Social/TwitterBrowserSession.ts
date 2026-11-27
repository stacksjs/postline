import type { EngagementCounts } from '../../Support/Social/engagement-analytics'
import { db } from '@stacksjs/database'
import { UserFacingError } from '../../Support/Http/user-error'
import { engagementCounts } from '../../Support/Social/engagement-analytics'
import { saveTargetEngagement } from './save-target-engagement'
import { ensureAccount, now } from './support'

export async function twitterBrowserSession(): Promise<{ profile: string, handle: string | null }> {
  const account = await db.selectFrom('accounts').select(['uuid', 'twitter_browser_handle'])
    .where('id', '=', await ensureAccount()).executeTakeFirstOrThrow()
  return { profile: `postline-x-${account.uuid}`, handle: account.twitter_browser_handle ?? null }
}

export async function rememberTwitterBrowserHandle(handle: unknown): Promise<string | null> {
  if (handle !== null && (typeof handle !== 'string' || !/^[A-Za-z0-9_]{1,15}$/.test(handle)))
    throw new UserFacingError('Postline could not identify the signed-in X account.')

  await db.updateTable('accounts').set({ twitter_browser_handle: handle, updated_at: now() })
    .where('id', '=', await ensureAccount()).execute()
  return handle
}

export async function requireTwitterBrowserHandle(handle: unknown): Promise<string> {
  const session = await twitterBrowserSession()
  if (!session.handle || typeof handle !== 'string' || handle.toLowerCase() !== session.handle.toLowerCase())
    throw new UserFacingError('Check the X browser sign-in before reading its data.')
  return session.handle
}

export async function saveTwitterBrowserMetrics(handle: unknown, reports: unknown): Promise<number> {
  const confirmedHandle = await requireTwitterBrowserHandle(handle)
  if (!Array.isArray(reports) || reports.length > 100)
    throw new UserFacingError('Postline could not read the visible X post counts.')

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
