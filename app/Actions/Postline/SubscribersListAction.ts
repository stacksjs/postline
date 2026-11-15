import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { subscribers } from '../../Services/SubscriberService'

export default new Action({
  name: 'Postline Subscribers List',
  description: 'List the publication readers, with headline stats.',
  method: 'GET',

  async handle(request: RequestInstance) {
    try {
      return response.json({
        ok: true,
        data: {
          subscribers: await subscribers.list({
            status: String(request.get('status') || '') || undefined,
            plan: String(request.get('plan') || '') || undefined,
          }),
          stats: await subscribers.stats(),
        },
      })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
