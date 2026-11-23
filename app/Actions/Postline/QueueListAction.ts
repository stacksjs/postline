import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { postQueue } from '../../Services/Social/QueueService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Queue List',
  description: 'List posts with their per-provider targets, a page at a time.',
  method: 'GET',

  async handle(request: RequestInstance) {
    try {
      // `before` is the cursor the previous page returned. `limit` lets a
      // refresh reload as many rows as are already on screen.
      const page = await postQueue.listPage({
        before: Number(request.get('before')) || null,
        limit: Number(request.get('limit')) || undefined,
      })
      return response.json({ ok: true, data: page })
    }
    catch (error) {
      return actionFailure(error, 500)
    }
  },
})
