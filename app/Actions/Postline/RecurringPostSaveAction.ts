import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { recurringPosts } from '../../Services/RecurringPostService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Recurring Post Save',
  description: 'Create or change the repeat schedule for a post.',
  method: 'POST',
  async handle(request) {
    try {
      const action = request.get('action')
      const schedule = { interval: request.get('interval'), startAt: request.get('startAt') }
      const data = action === 'create'
        ? await recurringPosts.create({ ...schedule, id: request.get('id'), withoutImages: request.get('withoutImages') === true })
        : await recurringPosts.change(request.get('uuid'), action, schedule)
      return response.json({ ok: true, data }, { status: action === 'create' ? 201 : 200 })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
