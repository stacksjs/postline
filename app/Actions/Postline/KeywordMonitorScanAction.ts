import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
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
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
