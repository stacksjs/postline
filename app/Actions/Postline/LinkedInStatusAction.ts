import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { linkedin } from '../../Services/Social/LinkedInService'

export default new Action({
  name: 'Postline LinkedIn Status',
  description: 'Return the current LinkedIn connection state.',
  method: 'GET',

  async handle() {
    try {
      return response.json({ ok: true, data: await linkedin.status() })
    }
    catch (error) {
      return actionFailure(error, 500)
    }
  },
})
