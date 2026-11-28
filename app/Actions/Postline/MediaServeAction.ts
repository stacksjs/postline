import type { RequestInstance } from '@stacksjs/types'
import process from 'node:process'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { isBlogAttachmentFile } from '../../Support/Social/blog-attachments'
import { canFetchMedia, isSafeMediaFilename, storedImageResponse } from '../../Support/Social/uploads'

/**
 * Serve a stored post image so a remote platform can fetch it server-side.
 *
 * Instagram and Threads publish an image by handing the Meta Graph API a public
 * `image_url` it downloads itself — an uploaded file sitting on local disk is
 * unreachable to them. This route exposes those files at a stable URL.
 *
 * The provider fetches it without a workspace session. A publishing request
 * issues a signature tied to the file and its expiry. The filename must be a
 * validated basename inside the media directory.
 */
export default new Action({
  name: 'Postline Media Serve',
  description: 'Serve a stored post image for remote platforms (Instagram/Threads) to fetch.',
  method: 'GET',

  async handle(request: RequestInstance) {
    const file = String(request.get('file') || '').trim()
    if (!isSafeMediaFilename(file))
      return response.json({ ok: false, error: 'Invalid media reference.' }, { status: 400 })

    const expiry = String(request.get('expires') || '')
    const signature = String(request.get('signature') || '')
    // Blog attachments are public only while their own article is public.
    const allowed = !isBlogAttachmentFile(file) && canFetchMedia(file, expiry, signature, process.env.APP_KEY)
    const stored = allowed ? await storedImageResponse(file, 'private, no-store') : null
    return stored ?? response.json({ ok: false, error: 'Media not found.' }, { status: 404 })
  },
})
