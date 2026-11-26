import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { UserFacingError } from '../../Support/Http/user-error'
import { postQueue } from '../../Services/Social/QueueService'
import { MAX_QUEUE_SELECTION } from '../../Support/Social/rescheduling'

export default new Action({
  name: 'Postline Queue Delete',
  description: 'Remove a draft, scheduled, or failed post from the queue.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const ids = request.get('ids') ?? [Number(request.get('id'))]
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_QUEUE_SELECTION
      || !ids.every(id => typeof id === 'number' && Number.isSafeInteger(id) && id > 0) || new Set(ids).size !== ids.length)
      return response.json({ ok: false, error: `Select between 1 and ${MAX_QUEUE_SELECTION} different posts.` }, { status: 422 })

    try {
      const receipt = await postQueue.removeWithUndo(ids)
      return response.json({ ok: true, data: { ...receipt, ...(ids.length === 1 ? { id: ids[0] } : {}) } }, { headers: { 'Cache-Control': 'private, no-store' } })
    }
    catch (error) {
      return actionFailure(error, error instanceof UserFacingError && error.code === 'queue_removal_changed' ? 409 : 422)
    }
  },
})
