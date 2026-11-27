import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { trackedLinks } from '../../Services/TrackedLinkService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Tracked Link Create',
  description: 'Make a first-party short link to a public web address.',
  method: 'POST',

  async handle(request) {
    try {
      const data = await trackedLinks.create({
        name: request.get('name'),
        destination: request.get('destination'),
        utm: {
          source: request.get('source'),
          medium: request.get('medium'),
          campaign: request.get('campaign'),
          content: request.get('content'),
          term: request.get('term'),
        },
      })
      return response.json({ ok: true, data }, { status: 201 })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
