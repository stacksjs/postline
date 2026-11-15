import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { keywordMonitoring } from '../../Services/KeywordMonitoringService'

export default new Action({
  name: 'Postline Keyword Monitor Save',
  description: 'Create or update a social-listening keyword rule.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      const monitor = await keywordMonitoring.save(Number(request.get('id') || 0), {
        name: String(request.get('name') || ''),
        keywords: request.get('keywords'),
        providers: request.get('providers'),
        matchMode: String(request.get('match_mode') || 'any'),
        status: String(request.get('status') || 'active'),
      })
      return response.json({ ok: true, data: { monitor } })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
