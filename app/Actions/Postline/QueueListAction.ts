import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
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
      return response.json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, { status: 500 })
    }
  },
})
