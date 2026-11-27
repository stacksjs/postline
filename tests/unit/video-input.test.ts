import type { ProviderPublisher } from '../../app/Services/Social/CrosspostService'
import type { PublishContent } from '../../app/Support/Social/types'
import { expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { CrosspostService } from '../../app/Services/Social/CrosspostService'
import { copyRecurringSegments, QueueService, removeRecurringMedia } from '../../app/Services/Social/QueueService'
import { DELETE_EVERYTHING_PHRASE, workspaceArchive } from '../../app/Services/WorkspaceArchiveService'
import { readPostAttachments } from '../../app/Support/Social/attachment-input'
import { hydrateStoredContent, parseStoredContent } from '../../app/Support/Social/stored-content'
import { storedImageResponse } from '../../app/Support/Social/uploads'
import { checkVideoBytes, readVideoInput } from '../../app/Support/Social/video-input'

function box(type: string, ...fields: Array<string | Buffer>): Buffer {
  const payload = Buffer.concat(fields.map(field => Buffer.from(field)))
  const header = Buffer.alloc(8)
  header.writeUInt32BE(payload.length + header.length)
  header.write(type, 4, 4, 'ascii')
  return Buffer.concat([header, payload])
}

function fixture(handler: string): Buffer {
  return Buffer.concat([
    box('ftyp', 'isom', Buffer.alloc(4)),
    box('mdat', Buffer.from([1, 2, 3])),
    box('moov', box('trak', box('mdia', box('hdlr', Buffer.alloc(8), handler)))),
  ])
}

test('validates the video track from bytes and keeps trimmed alt text', async () => {
  const file = new File([new Uint8Array(fixture('vide'))], 'clip.mp4', { type: 'application/octet-stream' })
  const result = await readVideoInput({ get: () => '  A changing sky  ', getFiles: () => [file] })
  expect(result).toMatchObject({ ok: true, video: { mimeType: 'video/mp4', altText: 'A changing sky' } })
})

test('rejects renamed audio, truncated tracks and multiple videos', async () => {
  expect(checkVideoBytes(fixture('soun')).ok).toBe(false)
  expect(checkVideoBytes(fixture('vide').subarray(0, -1)).ok).toBe(false)
  const clip = new File([new Uint8Array(fixture('vide'))], 'clip.mp4')
  expect(await readVideoInput({ get: () => null, getFiles: () => [clip, clip] }))
    .toEqual({ ok: false, error: 'Attach one video per post.' })
})


async function sampleVideo() {
  return {
    bytes: new Uint8Array(await Bun.file(new URL('../fixtures/postline-video.mp4', import.meta.url)).arrayBuffer()),
    mimeType: 'video/mp4' as const,
    altText: 'A blue rectangle',
  }
}

test('rejects a combined image and video submission before storing either file', async () => {
  const video = new File([(await sampleVideo()).bytes], 'clip.mp4', { type: 'video/mp4' })
  const result = await readPostAttachments({
    get: key => key === 'image_url' ? 'https://example.com/photo.png' : undefined,
    getFiles: key => key === 'video' ? [video] : [],
  })
  expect(result).toEqual({ ok: false, error: 'Attach images or one video per post.' })
})

test('a failed video send keeps its bytes for retry and for a workspace restore', async () => {
  const sends: Array<PublishContent['video']> = []
  const database = db as any
  const publisher: ProviderPublisher = {
    async publishToPost(post, content) {
      sends.push(content?.video)
      const ok = sends.length > 1
      await database.insertInto('post_targets').values({
        uuid: crypto.randomUUID(),
        provider: 'mastodon',
        status: ok ? 'published' : 'failed',
        post_id: post.id,
        failure_reason: ok ? null : 'Try again',
      }).execute()
      return { provider: 'mastodon', ok }
    },
  }
  const service = new CrosspostService({ mastodon: publisher })
  const queue = new QueueService(service)
  const video = await sampleVideo()
  await expect(queue.save({ text: 'Wrong network', providers: ['mastodon', 'blog'], video })).rejects.toThrow(/unavailable on blog/)
  await expect(queue.save({ text: 'Poll video', providers: ['mastodon'], video, options: { mastodon: { poll: { options: ['A', 'B'], expiresIn: 600 } } } })).rejects.toThrow(/poll or a quote/)
  const { postId } = await service.publish('A video to send', ['mastodon'], { video })
  const post = await database.selectFrom('posts').select(['content', 'uuid']).where('id', '=', postId).executeTakeFirstOrThrow()
  const filename = parseStoredContent(post.content)?.media?.[0]?.path
  expect(filename).toEndWith('.mp4')
  expect(await storedImageResponse(filename!, 'public')).toBeNull()

  const draft = await queue.get(postId)
  expect(draft.image).toBeNull()
  expect(draft.video).toEqual({ altText: video.altText, previewUrl: `/api/postline/queue/video?id=${postId}` })
  const range = await queue.previewVideo(postId, 'bytes=4-7')
  expect(range?.status).toBe(206)
  expect(range?.headers.get('content-range')).toBe(`bytes 4-7/${video.bytes.length}`)
  expect(await range?.text()).toBe('ftyp')

  expect((await queue.publishNow(postId)).results[0]?.ok).toBe(true)
  expect(sends).toEqual([video, video])

  const segments = [{ title: 'Video', body: 'A video to send', content: post.content }]
  const copies = await copyRecurringSegments(segments, ['mastodon'], false, copies => copies)
  expect(parseStoredContent(copies[0]?.content)?.media?.[0]?.path).not.toBe(filename)
  expect((await hydrateStoredContent(copies[0]?.content))?.video).toEqual(video)
  await removeRecurringMedia(copies)
  const withoutMedia = await copyRecurringSegments(segments, ['mastodon'], true, copies => copies)
  expect((await hydrateStoredContent(withoutMedia[0]?.content))?.video).toBeUndefined()

  const archive = await workspaceArchive.export()
  expect(archive.media[filename!]).toBe(Buffer.from(video.bytes).toString('base64'))
  await workspaceArchive.deleteEverything(DELETE_EVERYTHING_PHRASE)
  await workspaceArchive.import(archive)
  const restored = await database.selectFrom('posts').select('content').where('uuid', '=', post.uuid).executeTakeFirstOrThrow()
  expect(parseStoredContent(restored.content)?.media?.[0]).toMatchObject({ path: filename, altText: video.altText })
  expect((await workspaceArchive.export()).media[filename!]).toBe(archive.media[filename!])
})
