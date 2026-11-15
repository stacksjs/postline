import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { twitter } from '../../Services/Social/TwitterService'

export default new Action({
  name: 'Postline Twitter Callback',
  description: 'Handle the X/Twitter OAuth redirect and store the access token.',
  method: 'GET',

  async handle(request: RequestInstance) {
    const code = String(request.get('code') || '')
    const state = String(request.get('state') || '')
    const oauthError = String(request.get('error') || '')

    if (oauthError) {
      const description = String(request.get('error_description') || oauthError)
      return response.redirect(`/accounts?twitter=error&message=${encodeURIComponent(description)}`)
    }

    try {
      await twitter.handleCallback(code, state)
      return response.redirect('/accounts?twitter=connected')
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return response.redirect(`/accounts?twitter=error&message=${encodeURIComponent(message)}`)
    }
  },
})
