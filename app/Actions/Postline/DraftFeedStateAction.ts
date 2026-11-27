import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { draftFeeds } from '../../Services/DraftFeedService'
import { actionFailure } from '../../Support/Http/action-error'
import { UserFacingError } from '../../Support/Http/user-error'

export default new Action({
  name: 'Postline Draft Feed State',
  description: 'Pause or resume automatic imports for a feed.',
  method: 'POST',

  async handle(request) {
    try {
      const active = request.get('active')
      if (typeof active !== 'boolean') throw new UserFacingError('Choose whether the feed should be active.')
      return response.json({ ok: true, data: await draftFeeds.setActive(request.get('uuid'), active) })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
