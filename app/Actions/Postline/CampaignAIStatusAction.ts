import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { campaignAI } from '../../Services/CampaignAIService'

export default new Action({
  name: 'Postline Campaign AI Status',
  description: 'Return credential-safe Campaign Assistant provider status.',
  method: 'GET',

  async handle() {
    const configuration = campaignAI.configuration()
    return response.json({
      ok: true,
      data: {
        ...configuration,
        mode: configuration.configured ? 'ai' : 'template',
      },
    })
  },
})
