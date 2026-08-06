import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { billing } from '../../Services/BillingService'

export default new Action({
  name: 'The Open Times Checkout',
  description: 'Start a Stripe checkout session for a paid tier.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      const session = await billing.checkout({
        tierId: request.get('tier_id'),
        email: request.get('email'),
        name: request.get('name'),
        sourceEntryId: request.get('entry_id'),
      })

      return response.json({ ok: true, data: session })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
