import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { publicMessage } from '../../Support/Http/action-error'
import { linkedin } from '../../Services/Social/LinkedInService'

export default new Action({
  name: 'Postline LinkedIn Auth',
  description: 'Redirect the member to LinkedIn for OAuth consent.',
  method: 'GET',

  async handle() {
    try {
      return response.redirect(await linkedin.getAuthUrl())
    }
    catch (error) {
      const message = publicMessage(error)
      return response.redirect(`/accounts?linkedin=error&message=${encodeURIComponent(message)}`)
    }
  },
})
