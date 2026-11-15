import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
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
      return response.json({ ok: !allFailed, data }, { status: allFailed ? 422 : 200 })
    }
    catch (error) {
      return response.json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, { status: 422 })
    }
  },
})
