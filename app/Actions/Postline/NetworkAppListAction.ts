import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { networkApps } from '../../Services/NetworkAppService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Network App List',
  description: 'For each OAuth network: whether its app is set up, from where, and its redirect address.',
  method: 'GET',

  async handle() {
    try {
      return response.json({ ok: true, data: { apps: await networkApps.summary() } })
    }
    catch (error) {
      return actionFailure(error, 500)
    }
  },
})
