import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { publications } from '../../Services/PublicationService'
import { recommendations } from '../../Services/RecommendationService'

export default new Action({
  name: 'The Open Times Publication Get',
  description: 'Read the publication and the publications it recommends.',
  method: 'GET',

  async handle() {
    try {
      return response.json({
        ok: true,
        data: {
          publication: await publications.ensurePublication(),
          recommendations: await recommendations.list(),
        },
      })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
