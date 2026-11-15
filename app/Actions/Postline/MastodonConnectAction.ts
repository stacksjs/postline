import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { mastodon } from '../../Services/Social/MastodonService'

export default new Action({
  name: 'Postline Mastodon Connect',
  description: 'Connect a Mastodon account with an instance URL + access token.',
  method: 'POST',

  async handle(request: RequestInstance) {
    // With no body, connect from MASTODON_* env vars.
    const instance = String(request.get('instance') || '').trim()
    const accessToken = String(request.get('access_token') || request.get('token') || '').trim()

    try {
      const data = instance || accessToken
        ? await mastodon.connect({ instance, accessToken })
        : await mastodon.connectFromEnv()
      return response.json({ ok: true, data })
    }
    catch (error) {
      return response.json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, { status: 422 })
    }
  },
})
