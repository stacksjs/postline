import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { postQueue } from '../../Services/Social/QueueService'

export default new Action({
  name: 'Postline Queue Publish Now',
  description: 'Publish a draft, scheduled, or failed post immediately.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const id = Number(request.get('id') || 0)
    if (!id)
      return response.json({ ok: false, error: 'Post id is required.' }, { status: 422 })

    try {
      const data = await postQueue.publishNow(id)
      const allFailed = data.results.length > 0 && data.results.every(result => !result.ok)
      if (!allFailed)
        return response.json({ ok: true, data })

      // Say why, per network. Without `error` the client could only report
      // that the request failed.
      const reasons = data.results.map(result => result.error).filter(Boolean)
      return response.json({
        ok: false,
        error: [...new Set(reasons)].join(' ') || 'Nothing was published.',
        data,
      }, { status: 422 })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
