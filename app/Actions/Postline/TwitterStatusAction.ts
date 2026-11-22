import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { twitter } from '../../Services/Social/TwitterService'

export default new Action({
  name: 'Postline Twitter Status',
  description: 'Return the current X/Twitter connection state.',
  method: 'GET',

  async handle() {
    try {
      return response.json({ ok: true, data: await twitter.status() })
    }
    catch (error) {
      return actionFailure(error, 500)
    }
  },
})
