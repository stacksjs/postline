/**
 * A short-lived public link for an image, for the networks that fetch images
 * from an address (Instagram, Threads) when Postline has no public address of
 * its own: the Mac app, or a server on a home network.
 *
 * A tiny server on a random local port answers only for the images of the
 * post being sent, each under an unguessable path, and nothing else: not the
 * app, not its API. The framework's tunnel (`@stacksjs/tunnel`) gives that
 * port a public address for as long as the network takes to fetch the image,
 * and both are closed as soon as the post is created.
 *
 * Off unless the owner turns it on, because the tunnel relays the image
 * through a third-party server on its way to the network.
 */
import type { LocalTunnel } from '@stacksjs/tunnel'

export interface SharedImage {
  bytes: Uint8Array
  mimeType: string
}

export interface MediaShare {
  /** The public address of each image, in the order given. */
  urls: string[]
  close: () => Promise<void>
}

export type TunnelOpener = (port: number) => Promise<Pick<LocalTunnel, 'url' | 'close'>>

const defaultOpener: TunnelOpener = async (port) => {
  const { localTunnel } = await import('@stacksjs/tunnel')
  let lastError: Error | undefined
  try {
    // An error handler must be attached: the tunnel client reports a failed
    // connection as an 'error' event, and with no listener that event is
    // thrown, which would take the whole server down with one image.
    return await localTunnel({ port, timeout: 15_000, maxReconnectAttempts: 2, onError: (error) => { lastError = error } })
  }
  catch (error) {
    throw lastError && error instanceof Error && !error.message.includes(lastError.message)
      ? new Error(`${error.message} (${lastError.message})`)
      : error
  }
}

function extensionOf(mimeType: string): string {
  return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' } as Record<string, string>)[mimeType] || 'bin'
}

/** Serve these images, and only these, at a public address until `close`. */
export async function openMediaShare(images: readonly SharedImage[], openTunnel: TunnelOpener = defaultOpener): Promise<MediaShare> {
  const token = crypto.randomUUID().replaceAll('-', '')
  const files = new Map<string, SharedImage>()
  const names = images.map((image, index) => {
    const name = `${index + 1}-${crypto.randomUUID().slice(0, 8)}.${extensionOf(image.mimeType)}`
    files.set(`/${token}/${name}`, image)
    return name
  })

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      const image = request.method === 'GET' || request.method === 'HEAD' ? files.get(path) : undefined
      if (!image) return new Response('Not found', { status: 404 })
      return new Response(request.method === 'HEAD' ? null : (image.bytes as unknown as BodyInit), {
        headers: { 'content-type': image.mimeType, 'content-length': String(image.bytes.length), 'cache-control': 'no-store' },
      })
    },
  })

  let tunnel: Pick<LocalTunnel, 'url' | 'close'>
  try {
    tunnel = await openTunnel(Number(server.port))
  }
  catch (error) {
    server.stop(true)
    throw new Error(`Postline could not open a temporary link for the image: ${error instanceof Error ? error.message : String(error)}`)
  }

  const base = tunnel.url.replace(/\/+$/, '')
  let closed = false
  return {
    urls: names.map(name => `${base}/${token}/${name}`),
    close: async () => {
      if (closed) return
      closed = true
      try {
        await tunnel.close()
      }
      finally {
        server.stop(true)
      }
    },
  }
}
