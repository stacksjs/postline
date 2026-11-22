import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
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
      return actionFailure(error, 500)
    }
  },
})
