import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { postQueue } from '../../Services/Social/QueueService'

export default new Action({
  name: 'Postline Queue Get',
  description: 'Fetch one queued post\'s editable state for the composer.',
  method: 'GET',

  async handle(request: RequestInstance) {
    const id = Number(request.get('id') || 0)
    if (!id)
      return response.json({ ok: false, error: 'Post id is required.' }, { status: 422 })

    try {
      const data = await postQueue.get(id)
      return response.json({ ok: true, data })
    }
    catch (error) {
      return response.json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, { status: 404 })
    }
  },
})
