import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { threads } from '../../Services/Social/ThreadsService'

export default new Action({
  name: 'Postline Threads Callback',
  description: 'Handle the Threads OAuth redirect and store the access token.',
  method: 'GET',

  async handle(request: RequestInstance) {
    const code = String(request.get('code') || '')
    const state = String(request.get('state') || '')
    const oauthError = String(request.get('error') || '')

    if (oauthError) {
      const description = String(request.get('error_description') || oauthError)
      return response.redirect(`/accounts?threads=error&message=${encodeURIComponent(description)}`)
    }

    try {
      await threads.handleCallback(code, state)
      return response.redirect('/accounts?threads=connected')
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return response.redirect(`/accounts?threads=error&message=${encodeURIComponent(message)}`)
    }
  },
})
