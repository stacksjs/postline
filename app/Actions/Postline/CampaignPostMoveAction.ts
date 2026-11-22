import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { campaigns } from '../../Services/CampaignService'

export default new Action({
  name: 'Postline Campaign Post Move',
  description: 'Reschedule a campaign post after a calendar drag.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      const post = await campaigns.movePost(
        Number(request.get('campaign_id') || 0),
        Number(request.get('id') || 0),
        String(request.get('scheduled_at') || ''),
        Number(request.get('position') || 0),
      )
      return response.json({ ok: true, data: { post } })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
