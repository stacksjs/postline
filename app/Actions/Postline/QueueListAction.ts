import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { postQueue } from '../../Services/Social/QueueService'
import { actionFailure } from '../../Support/Http/action-error'
import { isRealTimestamp } from '../../Support/time'

export default new Action({
  name: 'Postline Queue List',
  description: 'List posts with their per-provider targets, a page at a time.',
  method: 'GET',

  async handle(request: RequestInstance) {
    const from = String(request.get('calendar_from') ?? '')
    const to = String(request.get('calendar_to') ?? '')
    if (from || to) {
      const range = Date.parse(to) - Date.parse(from)
      if (from.length !== 10 || to.length !== 10 || !isRealTimestamp(`${from} 00:00:00`)
        || !isRealTimestamp(`${to} 00:00:00`) || !(range > 0 && range <= 31 * 86_400_000))
        return response.json({ ok: false, error: 'Choose a calendar range of up to 31 days.' }, { status: 422 })
    }
    try {
      // `before` is the cursor the previous page returned. `limit` lets a
      // refresh reload as many rows as are already on screen.
      const page = await postQueue.listPage({
        before: Number(request.get('before')) || null,
        limit: Number(request.get('limit')) || undefined,
        search: String(request.get('q') ?? ''),
        calendar: from && to ? { from, to } : undefined,
      })
      const removals = request.get('include_undo') === '1' ? await postQueue.pendingRemovals() : undefined
      return response.json({ ok: true, data: { ...page, ...(removals ? { removals } : {}) } }, { headers: { 'Cache-Control': 'private, no-store' } })
    }
    catch (error) {
      return actionFailure(error, 500)
    }
  },
})
