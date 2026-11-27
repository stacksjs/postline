import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { draftFeeds } from '../../Services/DraftFeedService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Draft Feed Subscribe',
  description: 'Follow an RSS, Atom, or JSON feed for new drafts.',
  method: 'POST',

  async handle(request) {
    try {
      const data = await draftFeeds.subscribe(request.get('name'), request.get('url'), request.get('includeExisting') === true)
      return response.json({ ok: true, data }, { status: 201 })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
