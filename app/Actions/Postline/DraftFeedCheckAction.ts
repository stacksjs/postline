import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { draftFeeds } from '../../Services/DraftFeedService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Draft Feed Check',
  description: 'Read one saved feed immediately and import new entries as drafts.',
  method: 'POST',

  async handle(request) {
    try {
      return response.json({ ok: true, data: await draftFeeds.check(request.get('uuid')) })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
