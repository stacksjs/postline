import { describe, expect, spyOn, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { BlueskyDriver } from '../../app/Services/Social/Drivers/BlueskyDriver'
import { MastodonDriver } from '../../app/Services/Social/Drivers/MastodonDriver'
import { upsertIdentityRow } from '../../app/Services/Social/identities'
import { postQueue } from '../../app/Services/Social/QueueService'
import * as blueskyServers from '../../app/Support/Social/bluesky-server'
import { readPostOptions, sanitizePostOptions } from '../../app/Support/Social/post-options'
import { hydrateStoredContent } from '../../app/Support/Social/stored-content'
import { threadSegmentContent } from '../../app/Support/Social/threads'

const from = (fields: Record<string, unknown>) => (key: string) => fields[key]

describe('reading a post\'s options', () => {
  test('nothing set is nothing stored', () => {
    expect(readPostOptions(from({}))).toEqual({ ok: true, options: undefined })
    expect(readPostOptions(from({ language: '', mastodon_visibility: 'public', mastodon_spoiler: '  ' }))).toEqual({ ok: true, options: undefined })
  })

  test('a language, a visibility and a content warning', () => {
    expect(readPostOptions(from({ language: 'pt-BR', mastodon_visibility: 'unlisted', mastodon_spoiler: 'Film ending' }))).toEqual({
      ok: true,
      options: { language: 'pt-BR', mastodon: { visibility: 'unlisted', spoilerText: 'Film ending' } },
    })
  })

  test('nonsense is refused with a reason', () => {
    expect(readPostOptions(from({ language: 'english' }))).toEqual({ ok: false, error: '"english" is not a language code Postline knows, such as en or pt-BR.' })
    expect(readPostOptions(from({ mastodon_visibility: 'everyone' })).ok).toBe(false)
    expect(readPostOptions(from({ mastodon_spoiler: 'x'.repeat(501) })).ok).toBe(false)
  })

  test('keeps polls, quotes, labels and first comments through stored content', async () => {
    const read = readPostOptions(from({
      mastodon_poll: '{"options":[" Day ","Night"],"expiresIn":3600,"multiple":true,"hideTotals":true}',
      bluesky_quote: 'https://bsky.app/profile/someone.example/post/3kabc#bookmark',
      bluesky_labels: '["nudity","graphic-media","nudity"]',
      linkedin_first_comment: ' Article references ',
      instagram_first_comment: 'Photo credits',
    }))
    const options = {
      mastodon: { poll: { options: ['Day', 'Night'], expiresIn: 3600, multiple: true, hideTotals: true } },
      bluesky: { quote: 'https://bsky.app/profile/someone.example/post/3kabc', selfLabels: ['nudity', 'graphic-media'] },
      firstComments: { linkedin: 'Article references', instagram: 'Photo credits' },
    }
    expect(read).toEqual({ ok: true, options })
    expect(await hydrateStoredContent(JSON.stringify({ options }))).toEqual({ options })
    expect(readPostOptions(from({ mastodon_quote: 'https://mastodon.social/@somebody/123#part' }))).toEqual({
      ok: true, options: { mastodon: { quote: 'https://mastodon.social/@somebody/123' } },
    })
    expect(readPostOptions(from({ bluesky_quote: 'at://did:plc:example/app.bsky.feed.post/3kabc' })).ok).toBe(true)
  })

  test('rejects stale or conflicting options instead of silently sending the post without them', async () => {
    const poll = { options: ['Day', 'Night'], expiresIn: 3600 }
    expect(readPostOptions(from({ mastodon_poll: poll, mastodon_quote: 'https://mastodon.social/@somebody/123' })).ok).toBe(false)
    expect(readPostOptions(from({ mastodon_poll: { ...poll, options: ['Day', ' Day '] } })).ok).toBe(false)
    expect(readPostOptions(from({ mastodon_poll: '{' })).ok).toBe(false)
    expect(readPostOptions(from({ bluesky_labels: '["Not a label"]' })).ok).toBe(false)
    expect(readPostOptions(from({ bluesky_quote: 'https://other.example/profile/someone/post/3kabc' })).ok).toBe(false)
    await expect(hydrateStoredContent(JSON.stringify({ options: { mastodon: { poll: { ...poll, expiresIn: 0 } } } })))
      .rejects.toThrow('The saved post options could not be read.')
    await expect(hydrateStoredContent(JSON.stringify({ options: { firstComments: 'Legacy malformed comments' } })))
      .rejects.toThrow('Open this post in Composer to review its options.')
  })

  test('stored options are checked again on the way out', () => {
    expect(sanitizePostOptions({ language: 'de', mastodon: { visibility: 'private' } })).toEqual({ language: 'de', mastodon: { visibility: 'private' } })
    expect(sanitizePostOptions({ language: 'not a code' })).toBeUndefined()
    expect(sanitizePostOptions('junk')).toBeUndefined()
  })
})

describe('a thread\'s options', () => {
  test('every segment carries them, so a reply cannot drop a content warning', () => {
    const options = { language: 'en', mastodon: { spoilerText: 'Spoilers' } }
    const chain = { root: { uri: '1', cid: '1' }, parent: { uri: '1', cid: '1' } }
    expect(threadSegmentContent(1, { options }, chain)).toEqual({ reply: chain, options })
    expect(threadSegmentContent(1, { options }, undefined)).toEqual({ options })
    expect(threadSegmentContent(1, {}, undefined)).toBeUndefined()
  })

  test('keeps polls, quotes and first comments on the lead while labels apply throughout', () => {
    const options = {
      mastodon: { poll: { options: ['Day', 'Night'], expiresIn: 3600 } },
      bluesky: { quote: 'at://did:plc:example/app.bsky.feed.post/3kabc', selfLabels: ['nudity'] },
      firstComments: { linkedin: 'Read more' },
    }
    expect(threadSegmentContent(0, { options }, undefined)?.options).toEqual(options)
    expect(threadSegmentContent(1, { options }, undefined)).toEqual({ options: { bluesky: { selfLabels: ['nudity'] } } })
  })

})

test('scheduled threads send their persisted options through the selected native drivers', async () => {
  const poll = { options: ['Day', 'Night'], expiresIn: 3600, multiple: true }
  const permalink = 'https://bsky.app/profile/original.example/post/3kabc'
  const quote = { uri: 'at://did:plc:original/app.bsky.feed.post/3kabc', cid: 'bafkreiquote' }
  const instance = spyOn(MastodonDriver.prototype, 'instanceLimits').mockResolvedValue({
    characters: 500, charactersPerUrl: 23, mediaAttachments: 4,
  })
  const mastodon = spyOn(MastodonDriver.prototype, 'publish')
    .mockResolvedValueOnce({ provider: 'mastodon', uri: '191', cid: '191' })
    .mockResolvedValueOnce({ provider: 'mastodon', uri: '192', cid: '192' })
  const blueskyHome = spyOn(blueskyServers, 'resolveBlueskyServer').mockResolvedValue(blueskyServers.DEFAULT_BLUESKY_SERVER)
  const resolveQuote = spyOn(BlueskyDriver.prototype, 'resolveQuote').mockResolvedValue(quote)
  const bluesky = spyOn(BlueskyDriver.prototype, 'publish')
    .mockResolvedValueOnce({ provider: 'bluesky', uri: 'at://did:plc:options/app.bsky.feed.post/lead', cid: 'bafkreilead' })
    .mockResolvedValueOnce({ provider: 'bluesky', uri: 'at://did:plc:options/app.bsky.feed.post/reply', cid: 'bafkreireply' })
  const postIds: number[] = []
  const identities: number[] = []
  try {
    const tag = crypto.randomUUID()
    const mastodonAccount = await upsertIdentityRow('mastodon', { handle: tag }, {
      handle: tag, external_id: 'https://mastodon.social', auth_status: 'connected', access_token: 'mastodon-fixture',
    })
    identities.push(Number(mastodonAccount.id))
    const blueskyAccount = await upsertIdentityRow('bluesky', { handle: `${tag}.example` }, {
      handle: `${tag}.example`, external_id: 'did:plc:options', auth_status: 'connected', access_token: 'bluesky-fixture',
    })
    identities.push(Number(blueskyAccount.id))

    const scheduled = await postQueue.saveThread({
      texts: ['Lead', 'Follow-up'],
      providers: [`mastodon:${mastodonAccount.id}`, `bluesky:${blueskyAccount.id}`],
      scheduledAt: new Date(Date.now() + 10 * 60_000).toISOString().slice(0, 19).replace('T', ' '),
      options: { mastodon: { poll, spoilerText: 'Spoilers' }, bluesky: { quote: permalink, selfLabels: ['graphic-media'] } },
    })
    postIds.push(...scheduled.postIds)
    const { results } = await postQueue.publishNow(scheduled.postIds[0]!)
    expect(results).toHaveLength(4)
    expect(results.every(result => result.ok)).toBe(true)

    expect(mastodon.mock.calls[0]?.[0].accessToken).toBe('mastodon-fixture')
    expect(mastodon.mock.calls[0]?.[2]).toMatchObject({ poll, spoilerText: 'Spoilers' })
    expect(mastodon.mock.calls[1]?.[2]).toMatchObject({ spoilerText: 'Spoilers' })
    expect(mastodon.mock.calls[1]?.[2]).not.toHaveProperty('poll')
    expect(resolveQuote).toHaveBeenCalledTimes(1)
    expect(resolveQuote.mock.calls[0]).toMatchObject([{ accessToken: 'bluesky-fixture' }, permalink])
    expect(bluesky.mock.calls[0]?.[2]).toMatchObject({ quote, selfLabels: ['graphic-media'] })
    expect(bluesky.mock.calls[1]?.[2]).toMatchObject({ selfLabels: ['graphic-media'] })
    expect(bluesky.mock.calls[1]?.[2]).not.toHaveProperty('quote')
  }
  finally {
    for (const mock of [instance, mastodon, blueskyHome, resolveQuote, bluesky]) mock.mockRestore()
    for (const id of postIds) {
      await db.unsafe('DELETE FROM post_targets WHERE post_id = ?', [id])
      await db.unsafe('DELETE FROM posts WHERE id = ?', [id])
    }
    for (const id of identities) await db.unsafe('DELETE FROM social_identities WHERE id = ?', [id])
  }
})
