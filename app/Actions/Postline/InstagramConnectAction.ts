import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { instagram } from '../../Services/Social/InstagramService'

export default new Action({
  name: 'Postline Instagram Connect',
  description: 'Connect Instagram from a pre-obtained access token in the environment.',
  method: 'POST',

  async handle() {
    try {
      const data = await instagram.connectFromEnv()
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
