import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { comments } from '../../Services/CommentService'

export default new Action({
  name: 'Postline Comment Queue',
  description: 'List comments held for review.',
  method: 'GET',

  async handle() {
    try {
      return response.json({ ok: true, data: { comments: await comments.moderationQueue() } })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
