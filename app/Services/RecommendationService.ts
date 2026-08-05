/**
 * Publication recommendations: one writer pointing at another.
 *
 * The edge is stored by slug rather than only by id so it survives pointing at
 * a publication that has not joined yet. `resolve` fills in the id once the
 * target exists, which is also what makes the recommendation start counting
 * toward that publication's rank.
 */

import { db } from '@stacksjs/database'
import { publications, slugify } from './PublicationService'
import { now, uuid } from './Social/support'

const database = db as any

/** Enough to be a considered list rather than a directory. */
const MAX_RECOMMENDATIONS = 20

export interface RecommendationView {
  id: number
  targetSlug: string
  targetName: string
  note: string | null
  targetPublicationId: number | null
  /** Whether the target exists on this instance yet. */
  resolved: boolean
}

function recommendationRow(row: any): RecommendationView {
  return {
    id: Number(row.id),
    targetSlug: String(row.target_slug),
    targetName: String(row.target_name),
    note: row.note || null,
    targetPublicationId: row.target_publication_id ? Number(row.target_publication_id) : null,
    resolved: Boolean(row.target_publication_id),
  }
}

export class RecommendationService {
  async list(): Promise<RecommendationView[]> {
    const publication = await publications.ensurePublication()
    const rows = await database
      .selectFrom('publication_recommendations')
      .selectAll()
      .where('publication_id', '=', publication.id)
      .orderBy('created_at', 'desc')
      .execute()

    return rows.map(recommendationRow)
  }

  async add(input: { targetSlug: unknown, targetName: unknown, note?: unknown }): Promise<RecommendationView> {
    const publication = await publications.ensurePublication()
    const targetSlug = slugify(String(input.targetSlug || ''))
    const targetName = String(input.targetName || '').trim()

    if (!targetName) throw new Error('Give the publication you are recommending a name.')
    if (targetSlug === publication.slug) throw new Error('A publication cannot recommend itself.')

    const owned = await database
      .selectFrom('publication_recommendations')
      .select(['id'])
      .where('publication_id', '=', publication.id)
      .execute()

    if (owned.length >= MAX_RECOMMENDATIONS)
      throw new Error(`You can recommend up to ${MAX_RECOMMENDATIONS} publications.`)

    const existing = await database
      .selectFrom('publication_recommendations')
      .select(['id'])
      .where('publication_id', '=', publication.id)
      .where('target_slug', '=', targetSlug)
      .executeTakeFirst()

    if (existing) throw new Error('You already recommend that publication.')

    const recommendationUuid = uuid()
    await database.insertInto('publication_recommendations').values({
      uuid: recommendationUuid,
      publication_id: publication.id,
      target_slug: targetSlug,
      target_name: targetName.slice(0, 120),
      note: String(input.note || '').trim().slice(0, 500) || null,
      target_publication_id: await this.resolveTargetId(targetSlug),
      created_at: now(),
      updated_at: now(),
    }).execute()

    return recommendationRow(await database
      .selectFrom('publication_recommendations')
      .selectAll()
      .where('uuid', '=', recommendationUuid)
      .executeTakeFirstOrThrow())
  }

  async remove(id: number): Promise<void> {
    const publication = await publications.ensurePublication()
    const existing = await database
      .selectFrom('publication_recommendations')
      .select(['id'])
      .where('id', '=', id)
      .where('publication_id', '=', publication.id)
      .executeTakeFirst()

    if (!existing) throw new Error('That recommendation does not exist.')

    await database.deleteFrom('publication_recommendations').where('id', '=', id).execute()
  }

  /**
   * Attach ids to recommendations whose target has since joined.
   *
   * Run from the rerank job rather than on read, because an unresolved edge
   * already counts toward rank by slug: resolving it is about showing a link,
   * not about making the ranking correct.
   */
  async resolvePending(): Promise<{ resolved: number }> {
    const pending = await database
      .selectFrom('publication_recommendations')
      .selectAll()
      .where('target_publication_id', 'is', null)
      .execute()

    let resolved = 0
    for (const row of pending) {
      const targetId = await this.resolveTargetId(String(row.target_slug))
      if (!targetId) continue
      await database.updateTable('publication_recommendations')
        .set({ target_publication_id: targetId, updated_at: now() })
        .where('id', '=', row.id)
        .execute()
      resolved += 1
    }

    return { resolved }
  }

  private async resolveTargetId(slug: string): Promise<number | null> {
    const target = await database
      .selectFrom('publications')
      .select(['id'])
      .where('slug', '=', slug)
      .executeTakeFirst()

    return target ? Number(target.id) : null
  }
}

export const recommendations = new RecommendationService()
