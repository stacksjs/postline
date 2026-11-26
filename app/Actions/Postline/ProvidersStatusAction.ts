import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { providerStatuses } from '../../Services/WorkspaceBootstrapService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Providers Status',
  description: 'Return the connection state for every crosspost provider and its accounts.',
  method: 'GET',

  async handle() {
    try {
      const providers = await providerStatuses()

      // Each network entry keeps its single-account fields (the default
      // account) and carries `accounts` with every connected one; the flat
      // list is for callers that render per account rather than per network.
      const accounts = providers.flatMap(status => 'accounts' in status ? status.accounts : [])

      return response.json({ ok: true, data: { providers, accounts } })
    }
    catch (error) {
      return actionFailure(error, 500)
    }
  },
})
