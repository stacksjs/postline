import { Action } from '@stacksjs/actions'
import { trackedLinks } from '../../Services/TrackedLinkService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Tracked Link Redirect',
  description: 'Redirect an issued short link to its saved destination.',
  method: 'GET',

  async handle(request) {
    const headers = new Headers({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
    })
    try {
      const destination = await trackedLinks.resolve(request.param('code'), request.method === 'GET')
      if (!destination) return new Response(null, { status: 404, headers })
      headers.set('Location', destination)
      return new Response(null, { status: 302, headers })
    }
    catch (error) {
      return actionFailure(error, 500)
    }
  },
})
