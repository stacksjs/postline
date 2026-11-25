import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { aiSettings } from '../../Services/AISettingsService'
import { campaignAI } from '../../Services/CampaignAIService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline AI Settings Save',
  description: 'Save the AI provider, model and key used for campaign planning. A blank key keeps the saved one.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const field = (name: string): string | undefined => {
      const value = request.get(name)
      return value === undefined || value === null ? undefined : String(value)
    }

    try {
      const view = await aiSettings.save({
        provider: field('provider'),
        model: field('model'),
        apiKey: field('apiKey'),
        clearKey: ['1', 'true', 'on'].includes(String(field('clearKey') || '').toLowerCase()),
      })
      return response.json({ ok: true, data: { ...view, active: await campaignAI.configuration() } })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
