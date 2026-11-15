import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { keywordMonitoring } from '../../Services/KeywordMonitoringService'

export default new Action({
  name: 'Postline Keyword Mention Read',
  description: 'Mark one or more listening mentions as read.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      const updated = await keywordMonitoring.markRead(Number(request.get('id') || 0), Number(request.get('monitor_id') || 0))
      return response.json({ ok: true, data: { updated } })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
