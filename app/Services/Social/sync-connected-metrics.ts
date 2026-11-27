import type { PostMetrics, SocialIdentityCredentials, SocialMetricsDriver } from '@stacksjs/socials'
import type { IdentityLike } from '../../Support/Social/accounts'
import { db } from '@stacksjs/database'
import { isUsableIdentity } from '../../Support/Social/accounts'
import { describeNetworkError } from '../../Support/Social/network-errors'
import { listIdentityRows } from './identities'
import { now } from './support'

type MetricsSource = Extract<SocialMetricsDriver['provider'], 'linkedin' | 'instagram' | 'threads'>
type TargetMetrics = Omit<PostMetrics, 'uri'>

function measuredCounts(counts: PostMetrics): TargetMetrics {
  return Object.fromEntries(Object.entries(counts).filter(([field, value]) => field !== 'uri' && typeof value === 'number' && Number.isSafeInteger(value) && value >= 0))
}

/** Read private metrics only with the identity that published the post. */
export async function syncConnectedMetrics<T extends IdentityLike>(
  provider: MetricsSource,
  driver: SocialMetricsDriver,
  credentialsFor: (identity: T) => SocialIdentityCredentials | Promise<SocialIdentityCredentials>,
  limit = 100,
): Promise<{ synced: number, errors?: string[] }> {
  const identities = await listIdentityRows<T>(provider)
  let synced = 0
  const errors: string[] = []
  for (const identity of identities.filter(isUsableIdentity)) {
    const targets = await db.selectFrom('post_targets')
      .select(['id', 'remote_uri'])
      .where('provider', '=', provider)
      .where('status', '=', 'published')
      .where('social_identity_id', '=', Number(identity.id))
      .where('remote_uri', 'is not', null)
      .orderBy('id', 'desc')
      .limit(limit)
      .execute()
    const references = targets.flatMap(target => target.remote_uri ? [{ id: Number(target.id), uri: String(target.remote_uri) }] : [])
    if (!references.length) continue

    let counts: PostMetrics[]
    try {
      counts = await driver.metrics(await credentialsFor(identity), references.map(target => target.uri))
    }
    catch (error) {
      errors.push(describeNetworkError(provider, error, 'metrics'))
      continue
    }

    const byUri = new Map(counts.map(count => [count.uri, measuredCounts(count)]))
    const syncedAt = now()
    for (const target of references) {
      const count = byUri.get(target.uri)
      // A missing post or response with no counts cannot erase a measurement.
      if (!count || !Object.keys(count).length) continue
      const updated = await db.updateTable('post_targets').set({ metrics: JSON.stringify({ ...count, syncedAt }) })
        .where('id', '=', target.id)
        .where('status', '=', 'published')
        .where('social_identity_id', '=', Number(identity.id))
        .where('remote_uri', '=', target.uri)
        .returning('id')
        .executeTakeFirst()
      if (updated) synced++
    }
  }
  return { synced, ...(errors.length ? { errors } : {}) }
}
