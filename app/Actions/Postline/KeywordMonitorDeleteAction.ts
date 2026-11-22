import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { keywordMonitoring } from '../../Services/KeywordMonitoringService'

export default new Action({
  name: 'Postline Keyword Monitor Delete',
  description: 'Delete a social-listening rule and its saved mentions.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      await keywordMonitoring.remove(Number(request.get('id') || 0))
      return response.json({ ok: true })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
