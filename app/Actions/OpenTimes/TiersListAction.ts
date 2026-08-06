import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { billing, billingConfigured } from '../../Services/BillingService'
import { subscribers } from '../../Services/SubscriberService'

export default new Action({
  name: 'The Open Times Tiers List',
  description: 'List paid tiers and subscriber stats for the dashboard.',
  method: 'GET',

  async handle() {
    try {
      return response.json({
        ok: true,
        data: {
          tiers: await billing.listTiers(),
          stats: await subscribers.stats(),
          configured: billingConfigured(),
        },
      })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
