import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { alerts } from '../../Services/AlertService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Alert Read',
  description: 'Mark one alert read, or all of them.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      await alerts.markRead(Number(request.get('id')) || null)
      return response.json({ ok: true, data: await alerts.list() })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
