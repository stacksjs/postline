import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { recommendations } from '../../Services/RecommendationService'

export default new Action({
  name: 'Postline Recommendation Delete',
  description: 'Stop recommending a publication.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      await recommendations.remove(Number(request.get('id') || 0))

      return response.json({ ok: true, data: { removed: true } })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
