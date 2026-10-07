import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { accounts } from '../../Services/Social/AccountService'

export default new Action({
  name: 'The Open Times Account List',
  description: 'List every connected social account, across networks.',
  method: 'GET',

  async handle() {
    try {
      return response.json({ ok: true, data: { accounts: await accounts.list() } })
    }
    catch (error) {
      return response.json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, { status: 500 })
    }
  },
})
