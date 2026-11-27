import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { draftFeeds } from '../../Services/DraftFeedService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Draft Feed Remove',
  description: 'Remove a saved feed and keep the drafts it created.',
  method: 'POST',

  async handle(request) {
    try {
      await draftFeeds.remove(request.get('uuid'))
      return response.json({ ok: true })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
