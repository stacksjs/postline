import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { postFirstComments } from '../../Services/Social/PostFirstCommentService'

export default new Action({
  name: 'Retry Postline first comment',
  description: 'Retry a refused comment on an already published post.',
  method: 'POST',
  async handle(request: RequestInstance) {
    const id = Number(request.get('target_id'))
    if (!Number.isSafeInteger(id) || id <= 0)
      return response.json({ ok: false, error: 'A published target is required.' }, { status: 422 })
    try {
      const data = await postFirstComments.send(id, true)
      if (!data) return response.json({ ok: false, error: 'This comment is not available to retry.' }, { status: 409 })
      return response.json({ ok: true, data })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
