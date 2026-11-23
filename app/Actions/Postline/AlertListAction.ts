import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { alerts } from '../../Services/AlertService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Alert List',
  description: 'Things that need the owner, newest first, with how many are unread.',
  method: 'GET',

  async handle() {
    try {
      return response.json({ ok: true, data: await alerts.list() })
    }
    catch (error) {
      return actionFailure(error, 500)
    }
  },
})
