import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { threads } from '../../Services/Social/ThreadsService'

export default new Action({
  name: 'Postline Threads Connect',
  description: 'Connect Threads from a pre-obtained access token in the environment.',
  method: 'POST',

  async handle() {
    try {
      const data = await threads.connectFromEnv()
      return response.json({ ok: true, data })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
