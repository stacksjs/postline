import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { subscribers } from '../../Services/SubscriberService'

export default new Action({
  name: 'Postline Publication Subscribe',
  description: 'Add a reader to the publication, pending double opt-in.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      const result = await subscribers.subscribe({
        email: request.get('email'),
        name: request.get('name'),
        source: request.get('source'),
        sourceEntryId: request.get('entry_id'),
      })

      // Deliberately identical whether or not the address was already known:
      // a public form must not reveal who reads a publication.
      return response.json({
        ok: true,
        data: {
          status: result.subscriber.status,
          message: result.subscriber.status === 'active'
            ? 'You are already subscribed.'
            : 'Check your inbox to confirm your subscription.',
        },
      })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
