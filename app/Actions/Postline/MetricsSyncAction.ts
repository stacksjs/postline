import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { UserFacingError } from '../../Support/Http/user-error'
import { syncEngagement } from '../../Services/Social/EngagementService'

export default new Action({
  name: 'Postline Metrics Sync',
  description: 'Refresh engagement metrics for published posts on demand.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      const data = await syncEngagement({ includeTwitter: request.get('include_x') === true })
      if (!data.synced && data.errors.length)
        return actionFailure(new UserFacingError(data.errors.map(({ explanation }) => explanation).join(' '), 'engagement_sync_failed'), 422)
      return response.json({ ok: true, data })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
