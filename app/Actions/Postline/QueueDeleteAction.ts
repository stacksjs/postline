import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { postQueue } from '../../Services/Social/QueueService'

export default new Action({
  name: 'Postline Queue Delete',
  description: 'Remove a draft, scheduled, or failed post from the queue.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const id = Number(request.get('id') || 0)
    if (!id)
      return response.json({ ok: false, error: 'Post id is required.' }, { status: 422 })

    try {
      await postQueue.remove(id)
      return response.json({ ok: true, data: { id } })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
