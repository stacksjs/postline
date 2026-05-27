import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { linkedin } from '../../Services/Social/LinkedInService'

export default new Action({
  name: 'Postline LinkedIn Callback',
  description: 'Handle the LinkedIn OAuth redirect and store the access token.',
  method: 'GET',

  async handle(request: RequestInstance) {
    const code = String(request.get('code') || '')
    const state = String(request.get('state') || '')
    const oauthError = String(request.get('error') || '')

    if (oauthError) {
      const description = String(request.get('error_description') || oauthError)
      return response.redirect(`/accounts?linkedin=error&message=${encodeURIComponent(description)}`)
    }

    try {
      await linkedin.handleCallback(code, state)
      return response.redirect('/accounts?linkedin=connected')
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return response.redirect(`/accounts?linkedin=error&message=${encodeURIComponent(message)}`)
    }
  },
})
