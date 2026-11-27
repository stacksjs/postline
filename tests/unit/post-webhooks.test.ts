import { expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import { db } from '@stacksjs/database'
import { PostWebhookService } from '../../app/Services/PostWebhookService'

const secret = 'local-fixture-signing-secret-32-bytes'
const firstUrl = new URL('https://hooks.example.com/one')
const secondUrl = new URL('https://hooks.example.com/two')

test('signs exact request bytes, leases a delivery once, and keeps its ID on retry', async () => {
  let clock = Date.UTC(2027, 0, 20)
  const calls: Array<{ id: string, body: string, time: string }> = []
  const received = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const body = await request.text()
      const id = request.headers.get('postline-delivery')!
      const time = request.headers.get('postline-timestamp')!
      const expected = createHmac('sha256', secret).update(`${id}.${time}.${body}`).digest('hex')
      if (request.headers.get('postline-signature') !== `sha256=${expected}`) return new Response(null, { status: 400 })
      calls.push({ id, body, time })
      return new Response(null, { status: calls.length === 1 ? 503 : 204 })
    },
  })

  let url = firstUrl
  const service = new PostWebhookService(() => ({ url, secret }), async (_url, body, headers) =>
    (await fetch(received.url, { method: 'POST', body, headers })).status, () => clock)

  try {
    await db.transaction(tx => service.enqueue(tx, 'post.created', { postId: 17, status: 'draft', scheduledAt: null }))
    url = secondUrl
    expect(await service.deliverDue()).toEqual({ delivered: 0, retried: 0, failed: 0 })
    url = firstUrl
    const first = await Promise.all([service.deliverDue(), service.deliverDue()])
    expect(first.reduce((count, run) => count + run.retried, 0)).toBe(1)
    expect(calls).toHaveLength(1)

    clock += 59_000
    expect((await service.deliverDue()).delivered).toBe(0)
    clock += 1000
    expect((await service.deliverDue()).delivered).toBe(1)
    expect(calls).toHaveLength(2)
    expect(calls[1]!.id).toBe(calls[0]!.id)
    expect(calls[1]!.body).toBe(calls[0]!.body)
    expect(Number(calls[1]!.time)).toBe(Number(calls[0]!.time) + 60)
    const event = JSON.parse(calls[1]!.body)
    expect(event).toEqual({
      id: calls[1]!.id, type: 'post.created', createdAt: '2027-01-20T00:00:00.000Z',
      data: { postId: 17, status: 'draft', scheduledAt: null },
    })
    expect((await service.deliverDue()).delivered).toBe(0)
  }
  finally {
    await received.stop(true)
    if (calls[0]) await db.deleteFrom('post_webhook_deliveries').where('uuid', '=', calls[0].id).execute()
  }
})

test('recovers an expired lease and stops after eight failed attempts', async () => {
  let clock = Date.UTC(2027, 0, 20)
  const events: string[] = []
  const url = new URL('https://hooks.example.com/recovery')
  const service = new PostWebhookService(() => ({ url, secret }), async (_url, _body, headers) => {
    events.push(headers['postline-delivery']!)
    throw new Error('Receiver unavailable')
  }, () => clock)

  let deliveryId: number | undefined
  try {
    await db.transaction(tx => service.enqueue(tx, 'post.failed', { postId: 18, status: 'failed', reason: 'missed' }))
    const delivery = await db.selectFrom('post_webhook_deliveries').select('id').where('payload', 'like', '%"postId":18%').executeTakeFirstOrThrow()
    deliveryId = Number(delivery.id)
    await db.updateTable('post_webhook_deliveries').set({ lease: 'stopped-worker', available_at: '2027-01-20 00:01:30' })
      .where('id', '=', deliveryId).execute()
    expect((await service.deliverDue()).retried).toBe(0)
    clock += 90_000
    for (let index = 0; index < 7; index++) {
      expect((await service.deliverDue()).retried).toBe(1)
      clock += 60_000 * 2 ** index
    }
    expect((await service.deliverDue()).failed).toBe(1)
    expect(events).toHaveLength(8)
    expect(new Set(events).size).toBe(1)
    clock += 60_000 * 2 ** 7
    expect((await service.deliverDue()).failed).toBe(0)
    const saved = await db.selectFrom('post_webhook_deliveries').select(['status', 'attempts', 'failure'])
      .where('id', '=', deliveryId).executeTakeFirstOrThrow()
    expect(saved).toEqual({ status: 'failed', attempts: 8, failure: 'Delivery transport failed' })
  }
  finally {
    if (deliveryId) await db.deleteFrom('post_webhook_deliveries').where('id', '=', deliveryId).execute()
  }
})
