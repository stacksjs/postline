import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { newsletter } from '../../Services/NewsletterService'

export default new Action({
  name: 'The Open Times Send Queue',
  description: 'Queue a newsletter send to the publication readers.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      const send = await newsletter.queue({
        sourceKey: String(request.get('source_key') || `manual:${Date.now()}`),
        subject: String(request.get('subject') || ''),
        body: String(request.get('body') || ''),
        url: request.get('url') ? String(request.get('url')) : null,
        audience: String(request.get('audience') || 'everyone') === 'paid' ? 'paid' : 'everyone',
      })

      return response.json({ ok: true, data: { send } })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
