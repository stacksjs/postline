import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { recommendations } from '../../Services/RecommendationService'

export default new Action({
  name: 'The Open Times Recommendation Save',
  description: 'Recommend another publication to your readers.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      const recommendation = await recommendations.add({
        targetSlug: request.get('target_slug') || request.get('target_name'),
        targetName: request.get('target_name'),
        note: request.get('note'),
      })

      return response.json({ ok: true, data: { recommendation } })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
