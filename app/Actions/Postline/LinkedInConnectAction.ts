import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { linkedin } from '../../Services/Social/LinkedInService'

export default new Action({
  name: 'Postline LinkedIn Connect',
  description: 'Connect LinkedIn from a pre-obtained access token in the environment.',
  method: 'POST',

  async handle() {
    try {
      const data = await linkedin.connectFromEnv()
      return response.json({ ok: true, data })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
