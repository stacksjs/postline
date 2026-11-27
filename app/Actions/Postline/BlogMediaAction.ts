import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { db } from '@stacksjs/database'
import { response } from '@stacksjs/router'
import { isBlogAttachmentFile, readBlogAttachments } from '../../Support/Social/blog-attachments'
import { storedImageResponse } from '../../Support/Social/uploads'

export default new Action({
  name: 'Postline Blog Media',
  description: 'Serve an image attached to a published public article.',
  method: 'GET',

  async handle(request: RequestInstance) {
    const slug = String(request.get('slug') || '').trim()
    const file = String(request.get('file') || '').trim()
    if (!slug || slug.length > 220 || !isBlogAttachmentFile(file))
      return response.json({ ok: false, error: 'Invalid image reference.' }, { status: 400 })

    const post = await db.selectFrom('blog_posts').select('attachments')
      .where('slug', '=', slug).where('status', '=', 'published').where('access', '=', 'free').executeTakeFirst()
    if (post && readBlogAttachments(post.attachments).some(attachment => attachment.file === file)) {
      const image = await storedImageResponse(file, 'public, max-age=0, must-revalidate')
      if (image) return image
    }
    return response.json({ ok: false, error: 'Media not found.' }, { status: 404 })
  },
})
