import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { draftFeeds } from '../../Services/DraftFeedService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Draft Feed List',
  description: 'List feeds that create Queue drafts and their last check status.',
  method: 'GET',

  async handle() {
    try {
      return response.json({ ok: true, data: await draftFeeds.list() })
    }
    catch (error) {
      return actionFailure(error, 500)
    }
  },
})
