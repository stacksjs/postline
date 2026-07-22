import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { mastodon } from '../../Services/Social/MastodonService'

export default new Action({
  name: 'Postline Mastodon Status',
  description: 'Return the Mastodon connection status.',
  method: 'GET',

  async handle() {
    try {
      return response.json({ ok: true, data: await mastodon.status() })
    }
    catch (error) {
      return response.json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, { status: 500 })
    }
  },
})
