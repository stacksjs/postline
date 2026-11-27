import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { trackedLinks } from '../../Services/TrackedLinkService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Tracked Link Disable',
  description: 'Stop a short link from redirecting.',
  method: 'POST',

  async handle(request) {
    try {
      await trackedLinks.disable(request.get('code'))
      return response.json({ ok: true })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
