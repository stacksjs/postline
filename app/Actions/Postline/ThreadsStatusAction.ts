import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { threads } from '../../Services/Social/ThreadsService'

export default new Action({
  name: 'Postline Threads Status',
  description: 'Return the current Threads connection state.',
  method: 'GET',

  async handle() {
    try {
      return response.json({ ok: true, data: await threads.status() })
    }
    catch (error) {
      return response.json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, { status: 500 })
    }
  },
})
