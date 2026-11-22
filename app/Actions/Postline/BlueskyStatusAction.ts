import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { bluesky } from '../../Services/Social/BlueskyService'

export default new Action({
  name: 'Postline Bluesky Status',
  description: 'Return the current Bluesky connection state.',
  method: 'GET',

  async handle() {
    try {
      return response.json({ ok: true, data: await bluesky.status() })
    }
    catch (error) {
      return actionFailure(error, 500)
    }
  },
})
