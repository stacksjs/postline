import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { billing } from '../../Services/BillingService'

export default new Action({
  name: 'Postline Tier Save',
  description: 'Create or update a paid tier, mirroring it into Stripe.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      const tier = await billing.saveTier({
        id: request.get('id'),
        name: request.get('name'),
        description: request.get('description'),
        amountCents: request.get('amount_cents'),
        currency: request.get('currency'),
        interval: request.get('interval'),
        active: request.get('active'),
      })

      return response.json({ ok: true, data: { tier } })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
