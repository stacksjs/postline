import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { bluesky } from '../../Services/Social/BlueskyService'

export default new Action({
  name: 'Postline Bluesky Connect',
  description: 'Connect Bluesky using a handle and app password.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const identifier = String(request.get('identifier') || request.get('handle') || '').trim()
    const password = String(request.get('password') || request.get('appPassword') || '').trim()

    try {
      const data = identifier || password
        ? await bluesky.connect(identifier, password)
        : await bluesky.connectFromEnv()

      return response.json({ ok: true, data })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
