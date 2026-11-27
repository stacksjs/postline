import { expect, test } from 'bun:test'
import { changePostingSlot } from '../../app/Services/PostingSlotService'
import { postQueue } from '../../app/Services/Social/QueueService'
import { nextPostingSlot } from '../../app/Support/Social/posting-slots'

const sunday = { provider: 'blog', weekday: 0, minute: 150 } as const

test('posting slots use the local week and skip occupied minutes in UTC', () => {
  const from = new Date('2026-03-01T08:00:00Z')
  const occupied = new Set(['2026-03-01 10:30'])
  expect(nextPostingSlot([sunday], 'America/Los_Angeles', from, occupied)).toBe('2026-03-15 09:30:00')
})

test('posting slots choose the first free time and only use a repeated hour once', () => {
  const slots = [{ ...sunday, minute: 120 }, { ...sunday, minute: 90 }]
  const occupied = new Set<string>()
  expect(nextPostingSlot(slots, 'America/Los_Angeles', new Date('2026-11-01T07:00:00Z'), occupied)).toBe('2026-11-01 08:30:00')
  occupied.add('2026-11-01 08:30')
  expect(nextPostingSlot(slots, 'America/Los_Angeles', new Date('2026-11-01T09:00:00Z'), occupied)).toBe('2026-11-01 10:00:00')
})

test('clones kept media for each network in a draft thread while preserving the lead', async () => {
  const blog = { provider: 'blog', weekday: 1, minute: 501 }
  const bluesky = { provider: 'bluesky', weekday: 4, minute: 930 }
  const texts = ['Lead with attachment', 'Second segment'] as const
  const providers = ['blog', 'bluesky']
  const draft = await postQueue.saveThread({
    texts, providers, images: [{ bytes: new Uint8Array([0x89, 0x50, 0x4E, 0x47]), mimeType: 'image/png', altText: 'Draft image' }],
  })
  const ids = new Set(draft.postIds)
  try {
    await changePostingSlot(blog, false)
    await changePostingSlot(bluesky, false)
    const result = await postQueue.enqueueAtNextSlot({ text: texts[0], texts, providers }, draft.postIds[0])
    const [first, second] = result.slots
    if (!first?.postIds[0] || !second?.postIds[0]) throw new Error('Expected both queued threads.')
    for (const id of second.postIds) ids.add(id)
    expect(first.postIds).toEqual(draft.postIds)
    expect(second.scheduledAt).not.toBe(first.scheduledAt)
    const [primary, copy] = await Promise.all([postQueue.get(first.postIds[0]), postQueue.get(second.postIds[0])])
    expect(primary.thread?.texts).toEqual([...texts])
    expect(copy.thread?.texts).toEqual([...texts])
    expect(copy.images[0]?.altText).toBe('Draft image')
    await postQueue.remove(first.postIds[0])
    ids.delete(first.postIds[0])
    expect(await postQueue.previewImage(second.postIds[0], 0)).not.toBeNull()
  }
  finally {
    for (const id of ids) await postQueue.remove(id)
    await changePostingSlot(blog, true)
    await changePostingSlot(bluesky, true)
  }
})
