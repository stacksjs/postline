import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { subscribers } from '../../Services/SubscriberService'

export default new Action({
  name: 'Postline Subscriber Confirm',
  description: 'Confirm a double opt-in subscription.',
  method: 'GET',

  async handle(request: RequestInstance) {
    try {
      const subscriber = await subscribers.confirm(String(request.get('token') || ''))

      return response.json({ ok: true, data: { email: subscriber.email, status: subscriber.status } })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
