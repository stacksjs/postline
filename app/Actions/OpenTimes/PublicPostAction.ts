import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { publicPosts } from '../../Services/PublicPostService'

export default new Action({
  name: 'The Open Times Public Post',
  description: 'Read one published post as a reader, honouring the paywall.',
  method: 'GET',

  async handle(request: RequestInstance) {
    try {
      const slug = String(request.get('slug') || '')
      if (!slug) {
        return response.json({ ok: true, data: { posts: await publicPosts.list() } })
      }

      const post = await publicPosts.readPost(slug, request.get('reader'))
      if (!post) {
        return response.json({ ok: false, error: 'That post does not exist.' }, { status: 404 })
      }

      return response.json({ ok: true, data: { post } })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
