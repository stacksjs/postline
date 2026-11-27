import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { changePostingSlot } from '../../Services/PostingSlotService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Posting Slot Save',
  description: 'Add or remove a recurring posting time.',
  method: 'POST',
  async handle(request) {
    try {
      const data = await changePostingSlot({
        provider: request.get('provider'), weekday: request.get('weekday'), minute: request.get('minute'),
      }, request.get('remove') === true)
      return response.json({ ok: true, data })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
