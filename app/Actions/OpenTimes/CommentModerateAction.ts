import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { comments } from '../../Services/CommentService'

const ALLOWED = ['visible', 'pending', 'spam', 'removed'] as const

export default new Action({
  name: 'The Open Times Comment Moderate',
  description: 'Approve, hold, spam or remove a comment.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      const status = String(request.get('status') || '')
      if (!ALLOWED.includes(status as typeof ALLOWED[number]))
        throw new Error(`Status must be one of: ${ALLOWED.join(', ')}.`)

      const comment = await comments.setStatus(Number(request.get('id') || 0), status as typeof ALLOWED[number])

      return response.json({ ok: true, data: { comment } })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
