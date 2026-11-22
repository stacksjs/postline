import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { campaigns } from '../../Services/CampaignService'

export default new Action({
  name: 'Postline Campaign Activate',
  description: 'Send planned campaign posts into Postline scheduling.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      const data = await campaigns.activate(Number(request.get('campaign_id') || 0))
      return response.json({ ok: true, data })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
