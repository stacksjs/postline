/**
 * Engagement sync on a fresh install (#202): nothing published to Bluesky is
 * nothing to do, not a failure to log every half hour.
 */
import { describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { bluesky } from '../../app/Services/Social/BlueskyService'

const database = db as any

describe('engagement sync', () => {
  test('with no Bluesky account and nothing published, it has nothing to do', async () => {
    await database.deleteFrom('post_targets').where('provider', '=', 'bluesky').execute()
    await database.deleteFrom('social_identities').where('provider', '=', 'bluesky').execute()
    const before = { id: process.env.BLUESKY_IDENTIFIER, password: process.env.BLUESKY_APP_PASSWORD }
    delete process.env.BLUESKY_IDENTIFIER
    delete process.env.BLUESKY_APP_PASSWORD
    try {
      expect(await bluesky.syncMetrics()).toEqual({ synced: 0 })
    }
    finally {
      if (before.id !== undefined) process.env.BLUESKY_IDENTIFIER = before.id
      if (before.password !== undefined) process.env.BLUESKY_APP_PASSWORD = before.password
    }
  })
})
