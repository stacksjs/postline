import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { accounts } from '../../Services/Social/AccountService'

export default new Action({
  name: 'Postline Account List',
  description: 'List every connected social account, across networks.',
  method: 'GET',

  async handle() {
    try {
      return response.json({ ok: true, data: { accounts: await accounts.list() } })
    }
    catch (error) {
      return actionFailure(error, 500)
    }
  },
})
