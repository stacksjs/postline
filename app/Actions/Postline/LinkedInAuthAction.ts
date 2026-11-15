import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { linkedin } from '../../Services/Social/LinkedInService'

export default new Action({
  name: 'Postline LinkedIn Auth',
  description: 'Redirect the member to LinkedIn for OAuth consent.',
  method: 'GET',

  async handle() {
    try {
      return response.redirect(linkedin.getAuthUrl())
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return response.redirect(`/accounts?linkedin=error&message=${encodeURIComponent(message)}`)
    }
  },
})
