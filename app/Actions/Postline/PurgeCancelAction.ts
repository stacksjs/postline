import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { postPurge } from '../../Services/Social/PurgeService'

export default new Action({
  name: 'Postline Purge Cancel',
  description: 'Stop a background deletion run after the deletion in hand.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const runId = String(request.get('run') || '')
    if (!postPurge.cancel(runId))
      return response.json({ ok: false, error: 'That deletion run is not running.' }, { status: 409 })
    return response.json({ ok: true, data: postPurge.progress(runId) })
  },
})
