import { expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { directMessages } from '../../app/Services/DirectMessageService'
import { keywordMonitoring } from '../../app/Services/KeywordMonitoringService'

const database = db as any

test('workspace counts follow unread messages in open supported conversations and unread mentions', async () => {
  const prefix = 'unread-' + crypto.randomUUID()
  const inboxBefore = await directMessages.unreadCount()
  const listeningBefore = await keywordMonitoring.unreadCount()
  const monitor = await keywordMonitoring.save(0, { name: prefix, keywords: ['Postline'], providers: ['mastodon'], matchMode: 'any', status: 'active' })
  try {
    await database.insertInto('dm_conversations').values([
      { provider: 'bluesky', unread_count: 2, status: 'open' },
      { provider: 'mastodon', unread_count: 4, status: 'open' },
      { provider: 'mastodon', unread_count: 8, status: 'archived' },
      { provider: 'twitter', unread_count: 16, status: 'open' },
    ].map((row, index) => ({
      ...row,
      uuid: crypto.randomUUID(),
      remote_id: prefix + '-' + index,
      participant_handle: 'reader@example.test',
    }))).execute()
    await database.insertInto('keyword_mentions').values(['unread', 'unread', 'read'].map((status, index) => ({
      keyword_monitor_id: monitor.id,
      uuid: crypto.randomUUID(),
      provider: 'mastodon',
      remote_uri: prefix + '-' + index,
      url: 'https://example.test/status',
      author_handle: 'reader@example.test',
      body: 'Postline',
      matched_keywords: '["Postline"]',
      status,
      posted_at: '2026-11-26 12:00:00',
    }))).execute()

    expect(await directMessages.unreadCount()).toBe(inboxBefore + 6)
    expect(await keywordMonitoring.unreadCount()).toBe(listeningBefore + 2)
    await keywordMonitoring.markRead(0, monitor.id)
    expect(await keywordMonitoring.unreadCount()).toBe(listeningBefore)
  }
  finally {
    await database.deleteFrom('dm_conversations').where('remote_id', 'like', prefix + '-%').execute()
    await database.deleteFrom('keyword_mentions').where('keyword_monitor_id', '=', monitor.id).execute()
    await database.deleteFrom('keyword_monitors').where('id', '=', monitor.id).execute()
  }
})
