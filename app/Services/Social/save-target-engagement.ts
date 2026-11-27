import type { EngagementCounts } from '../../Support/Social/engagement-analytics'
import { db } from '@stacksjs/database'
import { engagementCounts, readEngagementMetrics } from '../../Support/Social/engagement-analytics'

export async function saveTargetEngagement(
  target: { id: number, identityId: number, uri: string },
  counts: EngagementCounts,
  syncedAt: string,
): Promise<boolean> {
  if (!Object.keys(counts).length) return false

  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await db.selectFrom('post_targets').select('metrics')
      .where('id', '=', target.id)
      .where('status', '=', 'published')
      .where('social_identity_id', '=', target.identityId)
      .where('remote_uri', '=', target.uri)
      .executeTakeFirst()
    if (!row) return false

    const previous = typeof row.metrics === 'string' ? readEngagementMetrics(row.metrics) : engagementCounts(row.metrics)
    const metrics = JSON.stringify({ ...previous, ...counts, syncedAt })
    // Another source can record different fields between our read and write.
    // Update only the snapshot we read, and merge again if it has changed.
    const update = db.updateTable('post_targets').set({ metrics })
      .where('id', '=', target.id)
      .where('status', '=', 'published')
      .where('social_identity_id', '=', target.identityId)
      .where('remote_uri', '=', target.uri)
    const pending = row.metrics == null
      ? update.where('metrics', 'is', null)
      : update.where('metrics', '=', row.metrics)
    if (await pending.returning('id').executeTakeFirst()) return true
  }
  return false
}
