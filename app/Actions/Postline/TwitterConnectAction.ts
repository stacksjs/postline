import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { twitter } from '../../Services/Social/TwitterService'

export default new Action({
  name: 'Postline Twitter Connect',
  description: 'Connect X/Twitter from a pre-obtained access token in the environment.',
  method: 'POST',

  async handle() {
    try {
      const data = await twitter.connectFromEnv()
      return response.json({ ok: true, data })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
