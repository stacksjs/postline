import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { comments } from '../../Services/CommentService'

export default new Action({
  name: 'The Open Times Comment Post',
  description: 'Post a comment or a reply on a published post.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      const comment = await comments.post({
        sourceKey: request.get('source_key'),
        body: request.get('body'),
        authorName: request.get('author_name'),
        authorEmail: request.get('author_email'),
        parentId: request.get('parent_id'),
        access: String(request.get('access') || 'everyone') as any,
      })

      return response.json({
        ok: true,
        data: {
          comment,
          // A held comment is reported honestly rather than shown as posted.
          held: comment.status === 'pending',
        },
      })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
