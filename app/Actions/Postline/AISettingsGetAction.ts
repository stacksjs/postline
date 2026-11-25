import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { aiSettings } from '../../Services/AISettingsService'
import { campaignAI } from '../../Services/CampaignAIService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline AI Settings',
  description: 'The AI provider saved in Settings, whether a key is saved, and what planning would use. Never the key.',
  method: 'GET',

  async handle() {
    try {
      const configuration = await campaignAI.configuration()
      return response.json({ ok: true, data: { ...await aiSettings.view(), active: configuration } })
    }
    catch (error) {
      return actionFailure(error)
    }
  },
})
