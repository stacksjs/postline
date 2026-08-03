import type { SocialProvider } from '../../Support/Social/types'
import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { campaigns, normalizeProviders } from '../../Services/CampaignService'

export default new Action({
  name: 'Postline Campaign Generate',
  description: 'Generate a multi-week campaign plan with the configured AI provider.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      const data = await campaigns.generate(Number(request.get('campaign_id') || 0), {
        count: Number(request.get('count') || 8),
        providers: normalizeProviders(request.get('providers')) as SocialProvider[],
        direction: String(request.get('direction') || '').trim(),
      })
      return response.json({ ok: true, data })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
