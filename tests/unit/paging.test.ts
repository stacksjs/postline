/**
 * Long lists come a page at a time and nothing is cut off (#105).
 */
import { describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { CONVERSATION_PAGE, directMessages } from '../../app/Services/DirectMessageService'
import { keywordMonitoring, MENTION_PAGE } from '../../app/Services/KeywordMonitoringService'

const database = db as any
const stamp = (offsetSeconds: number) => new Date(Date.UTC(2026, 10, 1) + offsetSeconds * 1000).toISOString().slice(0, 19).replace('T', ' ')

describe('paging', () => {
  test('every conversation is reachable, page by page, without repeats', async () => {
    const tag = crypto.randomUUID().slice(0, 8)
    for (let i = 0; i < 120; i++) {
      await database.insertInto('dm_conversations').values({
        uuid: crypto.randomUUID(), provider: 'bluesky', remote_id: `${tag}-${i}`, participant_handle: `p${i}.${tag}`,
        unread_count: 1, status: 'open', last_message_at: stamp(i), created_at: stamp(i),
      }).execute()
    }

    const seen: string[] = []
    let offset: number | null = 0
    let pages = 0
    while (offset !== null) {
      const page: any = await directMessages.list({ provider: 'bluesky', offset })
      expect(page.conversations.length).toBeLessThanOrEqual(CONVERSATION_PAGE)
      seen.push(...page.conversations.map((item: any) => item.participantHandle).filter((handle: string) => handle.endsWith(tag)))
      offset = page.nextOffset
      pages++
      expect(page.unreadCount).toBeGreaterThanOrEqual(120)
    }
    expect(pages).toBeGreaterThanOrEqual(3)
    expect(new Set(seen).size).toBe(120)
    expect(seen.length).toBe(120)
  })

  test('a long thread opens on its newest messages and pages back to the first', async () => {
    const tag = crypto.randomUUID().slice(0, 8)
    await database.insertInto('dm_conversations').values({ uuid: crypto.randomUUID(), provider: 'bluesky', remote_id: tag, participant_handle: tag, unread_count: 0, status: 'open', created_at: stamp(0) }).execute()
    const conversation = await database.selectFrom('dm_conversations').select(['id']).where('remote_id', '=', tag).executeTakeFirstOrThrow()
    for (let i = 0; i < 250; i++) {
      await database.insertInto('dm_messages').values({ uuid: crypto.randomUUID(), provider: 'bluesky', remote_id: `${tag}-${i}`, direction: 'incoming', author_handle: tag, body: `m${i}`, status: 'received', sent_at: stamp(i), created_at: stamp(i), dm_conversation_id: conversation.id }).execute()
    }

    const first: any = await directMessages.thread(Number(conversation.id), { markRead: false })
    expect(first.messages.at(-1).body).toBe('m249')
    const bodies = [...first.messages.map((m: any) => m.body)]
    let older = first.olderOffset
    while (older !== null) {
      const page: any = await directMessages.thread(Number(conversation.id), { markRead: false, offset: older })
      bodies.unshift(...page.messages.map((m: any) => m.body))
      older = page.olderOffset
    }
    expect(bodies.length).toBe(250)
    expect(bodies[0]).toBe('m0')
  })

  test('mentions page the same way', async () => {
    const tag = crypto.randomUUID().slice(0, 8)
    await database.insertInto('keyword_monitors').values({ uuid: crypto.randomUUID(), name: tag, keywords: JSON.stringify([tag]), providers: JSON.stringify(['bluesky']), match_mode: 'any', status: 'active', created_at: stamp(0) }).execute()
    const monitor = await database.selectFrom('keyword_monitors').select(['id']).where('name', '=', tag).executeTakeFirstOrThrow()
    for (let i = 0; i < 120; i++) {
      await database.insertInto('keyword_mentions').values({ uuid: crypto.randomUUID(), provider: 'bluesky', remote_uri: `at://${tag}/${i}`, url: `https://bsky.app/${i}`, author_handle: 'a', body: `${tag} ${i}`, matched_keywords: JSON.stringify([tag]), status: 'unread', posted_at: stamp(i), created_at: stamp(i), keyword_monitor_id: monitor.id }).execute()
    }
    const ids = new Set<number>()
    let offset: number | null = 0
    while (offset !== null) {
      const page: any = await keywordMonitoring.list(Number(monitor.id), offset)
      expect(page.mentions.length).toBeLessThanOrEqual(MENTION_PAGE)
      for (const mention of page.mentions) ids.add(mention.id)
      offset = page.nextOffset
    }
    expect(ids.size).toBe(120)
  })
})
