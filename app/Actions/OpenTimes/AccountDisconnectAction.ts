import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { accounts } from '../../Services/Social/AccountService'

export default new Action({
  name: 'The Open Times Account Disconnect',
  description: 'Disconnect one social account. Its tokens are dropped; its post history is kept.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const id = Number(request.get('id') || 0)
    if (!id)
      return response.json({ ok: false, error: 'Account id is required.' }, { status: 422 })

    try {
      const data = await accounts.disconnect(id)
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
