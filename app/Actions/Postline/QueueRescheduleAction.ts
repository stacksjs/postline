import type { RequestInstance } from '@stacksjs/types'
import type { ScheduledSelection, ScheduleDestination } from '../../Support/Social/rescheduling'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { postQueue } from '../../Services/Social/QueueService'
import { actionFailure } from '../../Support/Http/action-error'
import { UserFacingError } from '../../Support/Http/user-error'
import { MAX_QUEUE_SELECTION } from '../../Support/Social/rescheduling'
import { isRealTimestamp } from '../../Support/time'

function isSelection(value: unknown): value is ScheduledSelection {
  if (!value || typeof value !== 'object') return false
  const { id, scheduledAt } = value as Partial<ScheduledSelection>
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0
    && typeof scheduledAt === 'string' && scheduledAt.length === 19 && isRealTimestamp(scheduledAt)
}

export default new Action({
  name: 'Postline Queue Reschedule',
  description: 'Move scheduled posts to another day in the workspace time zone.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const posts = request.get('posts')
    const days = request.get('days') ?? undefined
    const date = request.get('date') ?? undefined
    if (!Array.isArray(posts) || posts.length === 0 || posts.length > MAX_QUEUE_SELECTION || !posts.every(isSelection))
      return response.json({ ok: false, error: `Select between 1 and ${MAX_QUEUE_SELECTION} scheduled posts.` }, { status: 422 })
    if (new Set(posts.map(post => post.id)).size !== posts.length)
      return response.json({ ok: false, error: 'Select each post once.' }, { status: 422 })

    let destination: ScheduleDestination | undefined
    if (date === undefined && typeof days === 'number' && Number.isInteger(days) && days !== 0 && Math.abs(days) <= 365)
      destination = { days }
    else if (days === undefined && typeof date === 'string' && isRealTimestamp(`${date} 00:00:00`))
      destination = { date }
    if (!destination)
      return response.json({ ok: false, error: 'Pick a date or move the posts by up to 365 days.' }, { status: 422 })

    try {
      const data = await postQueue.reschedule(posts, destination)
      return response.json({ ok: true, data })
    }
    catch (error) {
      return actionFailure(error, error instanceof UserFacingError && error.code === 'queue_schedule_changed' ? 409 : 422)
    }
  },
})
