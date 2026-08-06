import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { billing } from '../../Services/BillingService'

export default new Action({
  name: 'The Open Times Tier Archive',
  description: 'Archive a paid tier so nobody new can subscribe to it.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      await billing.archiveTier(Number(request.get('id') || 0))

      return response.json({ ok: true, data: { archived: true } })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
