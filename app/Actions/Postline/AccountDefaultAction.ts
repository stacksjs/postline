import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { accounts } from '../../Services/Social/AccountService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Account Default',
  description: 'Make one account the one its network publishes through by default.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const id = Number(request.get('id') || 0)
    if (!id)
      return response.json({ ok: false, error: 'Account id is required.' }, { status: 422 })

    try {
      const data = await accounts.makeDefault(id)
      return response.json({ ok: true, data })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
