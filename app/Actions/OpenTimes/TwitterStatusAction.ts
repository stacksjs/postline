import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { twitter } from '../../Services/Social/TwitterService'

export default new Action({
  name: 'The Open Times Twitter Status',
  description: 'Return the current X/Twitter connection state.',
  method: 'GET',

  async handle() {
    try {
      return response.json({ ok: true, data: await twitter.status() })
    }
    catch (error) {
      return response.json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, { status: 500 })
    }
  },
})
