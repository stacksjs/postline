import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { postQueue } from '../../Services/Social/QueueService'
import { actionFailure } from '../../Support/Http/action-error'
import { UserFacingError } from '../../Support/Http/user-error'

export default new Action({
  name: 'Postline Queue Undo Delete',
  description: 'Restore posts recently removed from the queue.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const token = String(request.get('token') ?? '').toLowerCase()
    if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/.test(token))
      return response.json({ ok: false, error: 'Select a recent removal to undo.' }, { status: 422 })
    try {
      return response.json({ ok: true, data: await postQueue.restoreRemoval(token) })
    }
    catch (error) {
      return actionFailure(error, error instanceof UserFacingError && error.code === 'queue_undo_unavailable' ? 410 : 422)
    }
  },
})
