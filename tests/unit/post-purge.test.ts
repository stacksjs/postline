import { describe, expect, test } from 'bun:test'
import { postPurge, PURGE_CONFIRMATION, PURGEABLE_PROVIDERS } from '../../app/Services/Social/PurgeService'

/**
 * Purge safeguards. The per-provider delete and enumeration calls moved into
 * `@stacksjs/socials` and are pinned by its own suite
 * (stacks/tests/unit/socials-deletion.test.ts); what belongs here is the
 * app-level policy around them — what may be purged, and what has to be true
 * before anything is deleted.
 */

describe('purge safeguards', () => {
  test('only providers whose API can delete are purgeable', () => {
    expect(PURGEABLE_PROVIDERS).toEqual(['postline', 'bluesky', 'twitter', 'mastodon', 'linkedin'])
    // Neither can delete a feed post through its API at all.
    expect(PURGEABLE_PROVIDERS).not.toContain('instagram')
    expect(PURGEABLE_PROVIDERS).not.toContain('threads')
  })

  test('our own feed is purgeable, since the rows are ours to delete', () => {
    // Postline is the one target with no external API in the way. Leaving it
    // out made "take it all back down" untrue for the network we run.
    expect(PURGEABLE_PROVIDERS).toContain('postline')
    // The blog stays out: those posts are managed from the blog itself, and
    // deleting an essay is not the same decision as clearing a feed.
    expect(PURGEABLE_PROVIDERS).not.toContain('blog')
  })

  test('refuses to execute without the exact confirmation phrase', async () => {
    for (const confirmation of ['', 'delete all posts', 'DELETE ALL POST', 'yes']) {
      await expect(postPurge.purge({ scope: 'all', confirmation })).rejects.toThrow(PURGE_CONFIRMATION)
    }
  })

  test('rejects an unknown provider before doing anything', async () => {
    await expect(postPurge.preview({ providers: ['myspace' as any] })).rejects.toThrow(/Unknown provider/)
  })

  test('reports why an unsupported provider is skipped instead of deleting', async () => {
    const result = await postPurge.preview({ providers: ['instagram'], scope: 'all' })
    const instagram = result.providers[0]

    expect(result.dryRun).toBe(true)
    expect(result.deleted).toBe(0)
    expect(instagram?.supported).toBe(false)
    expect(instagram?.matched).toBe(0)
    expect(instagram?.skippedReason).toContain('Instagram')
  })

  test('a preview never deletes, whatever the scope', async () => {
    for (const scope of ['tracked', 'all'] as const) {
      const result = await postPurge.preview({ providers: ['threads'], scope })
      expect(result.dryRun).toBe(true)
      expect(result.deleted).toBe(0)
      expect(result.failed).toBe(0)
    }
  })
})
