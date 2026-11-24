import { describe, expect, test } from 'bun:test'
import { openMediaShare } from '../../app/Support/Social/media-share'
import { isPublicBase } from '../../app/Support/Social/uploads'

const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 7])

/** A stand-in for the tunnel: the "public" address is the local port itself. */
function localOpener(log: string[]) {
  return async (port: number) => {
    log.push(`open ${port}`)
    return { url: `http://127.0.0.1:${port}`, close: async () => { log.push('close') } }
  }
}

describe('whether an address can be reached from the internet', () => {
  test('local names and private addresses cannot', () => {
    for (const base of ['postline.localhost', 'http://localhost:3008', 'https://app.test', 'mac.local', 'http://192.168.1.20', '10.0.0.5', '127.0.0.1:3000', 'intranet', 'https://[::1]:8443', ''])
      expect(isPublicBase(base)).toBe(false)
  })

  test('a public name or address can', () => {
    for (const base of ['postline.example.org', 'https://media.postline.app', '203.0.113.9'.replace('203.0.113.9', '8.8.8.8')])
      expect(isPublicBase(base)).toBe(true)
  })
})

describe('a temporary link for an image', () => {
  test('serves exactly the shared images, under a random path, until it is closed', async () => {
    const log: string[] = []
    const share = await openMediaShare([{ bytes: png, mimeType: 'image/png' }, { bytes: new Uint8Array([0xFF, 0xD8, 0xFF]), mimeType: 'image/jpeg' }], localOpener(log))

    expect(share.urls).toHaveLength(2)
    expect(share.urls[0]).toMatch(/\/[0-9a-f]{32}\/1-[0-9a-f]{8}\.png$/)
    const first = await fetch(share.urls[0]!)
    expect(first.status).toBe(200)
    expect(first.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(png)

    // Nothing else is served: not a guessed name, not the bare token, not the root.
    const base = new URL(share.urls[0]!)
    for (const path of ['/', base.pathname.split('/').slice(0, 2).join('/'), base.pathname.replace('1-', '9-'), '/api/postline/queue'])
      expect((await fetch(new URL(path, base))).status).toBe(404)
    expect((await fetch(share.urls[0]!, { method: 'POST' })).status).toBe(404)

    await share.close()
    expect(log).toEqual([`open ${base.port}`, 'close'])
    await expect(fetch(share.urls[0]!)).rejects.toThrow()
  })

  test('a tunnel that will not open leaves nothing running and says why', async () => {
    let port = 0
    const failing = async (p: number) => {
      port = p
      throw new Error('relay unreachable')
    }
    await expect(openMediaShare([{ bytes: png, mimeType: 'image/png' }], failing)).rejects.toThrow('could not open a temporary link for the image: relay unreachable')
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow()
  })
})

describe('at publish, for a network that fetches images from an address', () => {
  async function postWithImage(): Promise<number> {
    const { db } = await import('@stacksjs/database')
    const uuid = crypto.randomUUID()
    await (db as any).insertInto('posts').values({ uuid, title: 'share', body: 'share', status: 'draft', source: 'composer', timezone: 'UTC' }).execute()
    return Number((await (db as any).selectFrom('posts').select(['id']).where('uuid', '=', uuid).executeTakeFirstOrThrow()).id)
  }

  function instagram(seen: Array<string | undefined>) {
    return {
      async publishToPost(post: { id: number }, content: any) {
        // What Instagram would do: fetch the image from the address it was given.
        const url = content?.media?.[0]?.url
        seen.push(url)
        const response = url ? await fetch(url) : null
        const ok = Boolean(response?.ok)
        return { provider: 'instagram', ok, target: 'instagram', ...(ok ? {} : { error: 'could not fetch' }) }
      },
    }
  }

  test('with sharing allowed, the image goes out through a temporary link that is closed afterwards', async () => {
    const { CrosspostService } = await import('../../app/Services/Social/CrosspostService')
    const log: string[] = []
    const seen: Array<string | undefined> = []
    const service = new CrosspostService({ instagram: instagram(seen) } as never, (images) => openMediaShare(images, localOpener(log)), async () => true)

    const [result] = await service.publishExisting({ id: await postWithImage(), body: 'share' }, [{ provider: 'instagram', identityId: null }] as never, { media: [{ bytes: new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 1]), mimeType: 'image/jpeg' }] })

    expect(result!.ok).toBe(true)
    expect(seen[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\//)
    expect(log.at(-1)).toBe('close')
    await expect(fetch(seen[0]!)).rejects.toThrow()
  })

  test('without it, the post is refused with both fixes named, and nothing is opened', async () => {
    const { CrosspostService } = await import('../../app/Services/Social/CrosspostService')
    const log: string[] = []
    const seen: Array<string | undefined> = []
    const service = new CrosspostService({ instagram: instagram(seen) } as never, (images) => openMediaShare(images, localOpener(log)), async () => false)

    const [result] = await service.publishExisting({ id: await postWithImage(), body: 'share' }, [{ provider: 'instagram', identityId: null }] as never, { media: [{ bytes: new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 1]), mimeType: 'image/jpeg' }] })

    expect(result!.ok).toBe(false)
    expect(result!.error).toContain('Share images through a temporary link')
    expect(result!.error).toContain('STORAGE_PUBLIC_URL')
    expect(result!.retry).toEqual({ kind: 'permanent' })
    expect(seen).toEqual([])
    expect(log).toEqual([])
  })

  test('an image that already has a public address needs no link', async () => {
    const { CrosspostService } = await import('../../app/Services/Social/CrosspostService')
    const log: string[] = []
    const seen: Array<string | undefined> = []
    const passthrough = {
      async publishToPost(_post: unknown, content: any) {
        seen.push(content?.media?.[0]?.url)
        return { provider: 'instagram', ok: true, target: 'instagram' }
      },
    }
    const service = new CrosspostService({ instagram: passthrough } as never, (images) => openMediaShare(images, localOpener(log)), async () => false)
    await service.publishExisting({ id: await postWithImage(), body: 'share' }, [{ provider: 'instagram', identityId: null }] as never, { media: [{ url: 'https://media.example.org/a.jpg' }] })
    expect(seen).toEqual(['https://media.example.org/a.jpg'])
    expect(log).toEqual([])
  })
})
