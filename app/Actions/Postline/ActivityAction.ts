import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { activity } from '../../Services/ActivityService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Activity',
  description: 'What was sent where, what failed, and when each recurring job last ran.',
  method: 'GET',

  async handle(request: RequestInstance) {
    try {
      const kind = String(request.get('kind') || '')
      const before = Number(request.get('before')) || null
      const page = await activity.feed({
        before,
        limit: Number(request.get('limit')) || undefined,
        kind: kind === 'failed' || kind === 'published' ? kind : null,
      })
      // The jobs are the same on every page: send them with the first only.
      const system = before ? null : await activity.jobs()
      return response.json({ ok: true, data: { ...page, ...(system ?? {}) } })
    }
    catch (error) {
      return actionFailure(error, 500)
    }
  },
})
