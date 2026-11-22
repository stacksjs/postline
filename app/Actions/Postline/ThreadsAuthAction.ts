import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { publicMessage } from '../../Support/Http/action-error'
import { threads } from '../../Services/Social/ThreadsService'

export default new Action({
  name: 'Postline Threads Auth',
  description: 'Redirect to Threads for publishing consent.',
  method: 'GET',

  async handle() {
    try {
      return response.redirect(threads.getAuthUrl())
    }
    catch (error) {
      const message = publicMessage(error)
      return response.redirect(`/accounts?threads=error&message=${encodeURIComponent(message)}`)
    }
  },
})
