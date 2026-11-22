import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { keywordMonitoring } from '../../Services/KeywordMonitoringService'

export default new Action({
  name: 'Postline Keyword Monitor Scan',
  description: 'Run active keyword-monitor searches immediately.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      const data = await keywordMonitoring.scan(Number(request.get('monitor_id') || 0))
      return response.json({ ok: true, data })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
