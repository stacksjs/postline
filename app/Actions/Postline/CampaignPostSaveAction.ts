import type { RequestInstance } from '@stacksjs/types'
import type { CampaignPostInput } from '../../Services/CampaignService'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { campaigns, normalizeProviders } from '../../Services/CampaignService'

export default new Action({
  name: 'Postline Campaign Post Save',
  description: 'Create or edit a planned campaign post.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const input: CampaignPostInput = {
      campaignId: Number(request.get('campaign_id') || 0),
      id: Number(request.get('id') || 0) || undefined,
      title: String(request.get('title') || '').trim(),
      body: String(request.get('body') || '').trim(),
      providers: normalizeProviders(request.get('providers')),
      pillar: String(request.get('pillar') || 'story') as CampaignPostInput['pillar'],
      status: String(request.get('status') || 'idea') as CampaignPostInput['status'],
      scheduledAt: String(request.get('scheduled_at') || '').trim(),
      position: Number(request.get('position') || 0),
    }

    try {
      const post = await campaigns.savePost(input)
      return response.json({ ok: true, data: { post } })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
