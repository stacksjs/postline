import type { RequestInstance } from '@stacksjs/types'
import { join } from 'node:path'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { isSafeMediaFilename, MEDIA_DIR, mediaContentType } from '../../Support/Social/uploads'

/**
 * Serve a stored post image so a remote platform can fetch it server-side.
 *
 * Instagram and Threads publish an image by handing the Meta Graph API a public
 * `image_url` it downloads itself — an uploaded file sitting on local disk is
 * unreachable to them. This route exposes those files at a stable URL.
 *
 * It is intentionally UNAUTHENTICATED (Meta fetches it with no session), so it
 * is deliberately narrow: only a strictly-validated basename is accepted
 * (`isSafeMediaFilename` rejects any path separator or traversal), the filename
 * is an unguessable per-upload UUID, and nothing outside the media directory
 * can be reached.
 */
export default new Action({
  name: 'Postline Media Serve',
  description: 'Serve a stored post image for remote platforms (Instagram/Threads) to fetch.',
  method: 'GET',

  async handle(request: RequestInstance) {
    const file = String(request.get('file') || '').trim()
    if (!isSafeMediaFilename(file))
      return response.json({ ok: false, error: 'Invalid media reference.' }, { status: 400 })

    const stored = Bun.file(join(MEDIA_DIR, file))
    if (!(await stored.exists()))
      return response.json({ ok: false, error: 'Media not found.' }, { status: 404 })

    const bytes = new Uint8Array(await stored.arrayBuffer())
    return new Response(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'content-type': mediaContentType(file),
        // Filenames are unique per upload, so the bytes never change — let a
        // platform re-fetching the same URL hit its cache instead of the app.
        'cache-control': 'public, max-age=31536000, immutable',
      },
    })
  },
})
