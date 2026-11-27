import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { recurringPosts } from '../../Services/RecurringPostService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Recurring Post List',
  description: 'List repeating posts and their next scheduled times.',
  method: 'GET',
  async handle() {
    try {
      return response.json({ ok: true, data: await recurringPosts.list() })
    }
    catch (error) {
      return actionFailure(error, 500)
    }
  },
})
