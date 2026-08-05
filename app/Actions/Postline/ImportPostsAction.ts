import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { imports } from '../../Services/ImportService'

export default new Action({
  name: 'Postline Import Posts',
  description: 'Import an archive of posts into the publication.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      const raw = request.get('posts')
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (!Array.isArray(parsed)) throw new Error('Send `posts` as an array of { title, body, slug, publishedAt }.')

      return response.json({ ok: true, data: { report: await imports.importPosts(parsed) } })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
