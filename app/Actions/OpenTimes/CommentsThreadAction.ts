import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { comments } from '../../Services/CommentService'

export default new Action({
  name: 'The Open Times Comments Thread',
  description: 'Read the visible comment thread for one post.',
  method: 'GET',

  async handle(request: RequestInstance) {
    try {
      const sourceKey = String(request.get('source_key') || '')

      return response.json({ ok: true, data: { comments: await comments.thread(sourceKey) } })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
