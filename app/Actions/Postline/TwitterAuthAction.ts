import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { twitter } from '../../Services/Social/TwitterService'

export default new Action({
  name: 'Postline Twitter Auth',
  description: 'Redirect the user to X/Twitter for OAuth consent.',
  method: 'GET',

  async handle() {
    try {
      return response.redirect(await twitter.getAuthUrl())
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return response.redirect(`/accounts?twitter=error&message=${encodeURIComponent(message)}`)
    }
  },
})
