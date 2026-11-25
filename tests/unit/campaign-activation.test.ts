/**
 * Activating a campaign queues every ready post or none (#107).
 *
 * Runs the real campaign and queue services against the test database.
 */
import { describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { campaigns } from '../../app/Services/CampaignService'

const database = db as any

function future(days: number): string {
  const at = new Date(Date.now() + days * 86_400_000)
  return `${at.toISOString().slice(0, 10)}T09:00`
}

async function campaignWith(posts: Array<{ title: string, status: 'idea' | 'ready', scheduledAt: string, providers: string[] }>) {
  const campaign = await campaigns.create({ name: `Activation ${crypto.randomUUID().slice(0, 8)}`, startDate: future(-30).slice(0, 10), endDate: future(30).slice(0, 10), timezone: 'UTC' })
  for (const post of posts)
    await campaigns.savePost({ campaignId: campaign.id, title: post.title, body: `${post.title} body`, providers: post.providers as any, status: post.status, scheduledAt: post.scheduledAt })
  return campaign
}

async function queuedFor(campaignId: number): Promise<number> {
  const rows = await database.selectFrom('campaign_posts').select(['post_id']).where('launch_campaign_id', '=', campaignId).execute()
  return rows.filter((row: { post_id: number | null }) => row.post_id).length
}

describe('campaign activation', () => {
  test('an idea, a past date and an imageless Instagram post are all reported, and nothing is queued', async () => {
    const campaign = await campaignWith([
      { title: 'Ready one', status: 'ready', scheduledAt: future(2), providers: ['bluesky'] },
      { title: 'Just an idea', status: 'idea', scheduledAt: future(3), providers: ['bluesky'] },
      { title: 'Too late', status: 'ready', scheduledAt: future(-2), providers: ['bluesky'] },
      { title: 'Picture please', status: 'ready', scheduledAt: future(4), providers: ['instagram'] },
    ])

    const result = await campaigns.activate(campaign.id)

    expect(result.queued).toBe(0)
    expect(result.errors).toHaveLength(3)
    expect(result.errors.join('\n')).toContain('Just an idea: still an idea')
    expect(result.errors.join('\n')).toContain('Too late: its time has already passed')
    expect(result.errors.join('\n')).toContain('Picture please: Instagram needs an image')
    expect(await queuedFor(campaign.id)).toBe(0)
    expect((await campaigns.get(campaign.id)).campaign.status).not.toBe('active')
  })

  test('when every post is ready, all of them are queued and the campaign is active', async () => {
    const campaign = await campaignWith([
      { title: 'First', status: 'ready', scheduledAt: future(2), providers: ['bluesky'] },
      { title: 'Second', status: 'ready', scheduledAt: future(3), providers: ['mastodon'] },
    ])

    const result = await campaigns.activate(campaign.id)

    expect(result).toEqual({ queued: 2, skipped: 0, errors: [] })
    expect(await queuedFor(campaign.id)).toBe(2)
    expect((await campaigns.get(campaign.id)).campaign.status).toBe('active')
  })
})
