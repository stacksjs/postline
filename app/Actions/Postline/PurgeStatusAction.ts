import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { postPurge } from '../../Services/Social/PurgeService'

export default new Action({
  name: 'Postline Purge Status',
  description: 'Where a background deletion run has got to.',
  method: 'GET',

  async handle(request: RequestInstance) {
    const progress = postPurge.progress(String(request.get('run') || ''))
    if (!progress)
      return response.json({ ok: false, error: 'That deletion run is not known here. It may have finished before Postline restarted.' }, { status: 404 })
    return response.json({ ok: true, data: progress })
  },
})
