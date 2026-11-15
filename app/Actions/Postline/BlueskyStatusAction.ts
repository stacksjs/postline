import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
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
      return response.json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, { status: 500 })
    }
  },
})
