import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
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
      return response.json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, { status: 500 })
    }
  },
})
