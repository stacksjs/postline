import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { postingSlotSettings } from '../../Services/PostingSlotService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Posting Slot List',
  description: 'List recurring posting times for each network.',
  method: 'GET',
  async handle() {
    try {
      return response.json({ ok: true, data: await postingSlotSettings() })
    }
    catch (error) {
      return actionFailure(error, 500)
    }
  },
})
