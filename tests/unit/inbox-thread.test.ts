/**
 * Opening a conversation shows its latest messages.
 *
 * The thread used to be read oldest-first with a limit, so a conversation
 * longer than the limit opened on its first hundred messages and never showed
 * the newest reply.
 */
import { describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { directMessages } from '../../app/Services/DirectMessageService'

const database = db as any

async function conversationWith(count: number): Promise<number> {
  const remote = `thread-${crypto.randomUUID()}`
  await database.insertInto('dm_conversations').values({
    uuid: crypto.randomUUID(),
    provider: 'mastodon',
    remote_id: remote,
    participant_handle: 'someone@example.social',
    unread_count: 0,
  }).execute()
  const conversation = await database.selectFrom('dm_conversations').select(['id']).where('remote_id', '=', remote).executeTakeFirstOrThrow()

  const start = Date.UTC(2026, 0, 1)
  const rows = Array.from({ length: count }, (_unused, index) => ({
    uuid: crypto.randomUUID(),
    provider: 'mastodon',
    remote_id: `${remote}-${index + 1}`,
    direction: 'incoming',
    author_handle: 'someone@example.social',
    body: `message ${index + 1}`,
    sent_at: new Date(start + index * 60_000).toISOString().slice(0, 19).replace('T', ' '),
    dm_conversation_id: conversation.id,
  }))
  for (let offset = 0; offset < rows.length; offset += 50)
    await database.insertInto('dm_messages').values(rows.slice(offset, offset + 50)).execute()

  return Number(conversation.id)
}

describe('reading a conversation', () => {
  test('a long one opens on its newest messages, oldest first', async () => {
    const id = await conversationWith(150)

    const { messages } = await directMessages.thread(id, { markRead: false })
    const bodies = messages.map((message: any) => message.body)

    expect(bodies).toHaveLength(100)
    expect(bodies[0]).toBe('message 51')
    expect(bodies.at(-1)).toBe('message 150')
  })

  test('a short one is returned whole, in order', async () => {
    const id = await conversationWith(3)

    const { messages } = await directMessages.thread(id, { markRead: false })

    expect(messages.map((message: any) => message.body)).toEqual(['message 1', 'message 2', 'message 3'])
  })
})
