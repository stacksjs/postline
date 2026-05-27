import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { instagram } from '../../Services/Social/InstagramService'

export default new Action({
  name: 'Postline Instagram Callback',
  description: 'Handle the Facebook OAuth redirect and store the Instagram token.',
  method: 'GET',

  async handle(request: RequestInstance) {
    const code = String(request.get('code') || '')
    const state = String(request.get('state') || '')
    const oauthError = String(request.get('error') || '')

    if (oauthError) {
      const description = String(request.get('error_description') || oauthError)
      return response.redirect(`/accounts?instagram=error&message=${encodeURIComponent(description)}`)
    }

    try {
      await instagram.handleCallback(code, state)
      return response.redirect('/accounts?instagram=connected')
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return response.redirect(`/accounts?instagram=error&message=${encodeURIComponent(message)}`)
    }
  },
})
