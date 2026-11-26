import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { keywordMonitoring } from '../../Services/KeywordMonitoringService'

export default new Action({
  name: 'Postline Keyword Monitor List',
  description: 'List social-listening rules and their recent keyword mentions.',
  method: 'GET',

  async handle(request: RequestInstance) {
    try {
      const data = await keywordMonitoring.list(Number(request.get('monitor_id') || 0), Number(request.get('offset') || 0))
      return response.json({ ok: true, data })
    }
    catch (error) {
      return actionFailure(error, 500)
    }
  },
})
