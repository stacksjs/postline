import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { campaigns } from '../../Services/CampaignService'

export default new Action({
  name: 'The Open Times Campaign Post Delete',
  description: 'Remove an unqueued post from a campaign plan.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      await campaigns.removePost(Number(request.get('campaign_id') || 0), Number(request.get('id') || 0))
      return response.json({ ok: true })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
