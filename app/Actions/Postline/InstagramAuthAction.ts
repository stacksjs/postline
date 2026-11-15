import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { instagram } from '../../Services/Social/InstagramService'

export default new Action({
  name: 'Postline Instagram Auth',
  description: 'Redirect to Facebook for Instagram publishing consent.',
  method: 'GET',

  async handle() {
    try {
      return response.redirect(instagram.getAuthUrl())
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return response.redirect(`/accounts?instagram=error&message=${encodeURIComponent(message)}`)
    }
  },
})
