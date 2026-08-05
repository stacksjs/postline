import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { subscribers } from '../../Services/SubscriberService'

export default new Action({
  name: 'Postline Subscriber Unsubscribe',
  description: 'One-click unsubscribe from a mail footer.',
  method: 'GET',

  async handle(request: RequestInstance) {
    try {
      const result = await subscribers.unsubscribe(String(request.get('token') || ''))

      return response.json({ ok: true, data: { email: result.email, status: 'unsubscribed' } })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
