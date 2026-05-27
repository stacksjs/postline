import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { instagram } from '../../Services/Social/InstagramService'

export default new Action({
  name: 'Postline Instagram Status',
  description: 'Return the current Instagram connection state.',
  method: 'GET',

  async handle() {
    try {
      return response.json({ ok: true, data: await instagram.status() })
    }
    catch (error) {
      return response.json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, { status: 500 })
    }
  },
})
