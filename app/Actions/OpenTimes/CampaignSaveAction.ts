import type { RequestInstance } from '@stacksjs/types'
import type { CampaignInput } from '../../Services/CampaignService'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { campaigns } from '../../Services/CampaignService'

export default new Action({
  name: 'The Open Times Campaign Save',
  description: 'Create or update a launch campaign brief.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const id = Number(request.get('id') || 0)
    const input: CampaignInput & { status?: string } = {
      name: String(request.get('name') || '').trim(),
      objective: String(request.get('objective') || '').trim() || null,
      audience: String(request.get('audience') || '').trim() || null,
      tone: String(request.get('tone') || 'clear') as CampaignInput['tone'],
      startDate: String(request.get('start_date') || '').trim(),
      endDate: String(request.get('end_date') || '').trim(),
      timezone: String(request.get('timezone') || '').trim() || undefined,
      status: String(request.get('status') || '').trim() || undefined,
    }

    try {
      const campaign = id ? await campaigns.update(id, input) : await campaigns.create(input)
      return response.json({ ok: true, data: { campaign } })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
