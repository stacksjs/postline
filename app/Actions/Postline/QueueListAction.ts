import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { postQueue } from '../../Services/Social/QueueService'

export default new Action({
  name: 'Postline Queue List',
  description: 'List recent posts with their per-provider targets.',
  method: 'GET',

  async handle() {
    try {
      const items = await postQueue.list()
      return response.json({ ok: true, data: { items } })
    }
    catch (error) {
      return actionFailure(error, 500)
    }
  },
})
