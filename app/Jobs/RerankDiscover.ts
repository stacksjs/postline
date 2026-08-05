import { Job } from '@stacksjs/queue'
import { Every } from '@stacksjs/types'
import { discover } from '../Services/DiscoverService'
import { recommendations } from '../Services/RecommendationService'

export default new Job({
  name: 'RerankDiscover',
  description: 'Decay and recompute Discover ranking, and resolve pending recommendations.',
  queue: 'default',
  tries: 1,
  backoff: 10,
  rate: Every.Hour,

  handle: async () => {
    try {
      // Order matters: resolving a recommendation can change the rank of the
      // publication it points at, so resolve first and rank against the result.
      const resolved = await recommendations.resolvePending()
      const reranked = await discover.rerankAll()

      return { ...reranked, ...resolved }
    }
    catch (error) {
      return { reranked: 0, resolved: 0, error: error instanceof Error ? error.message : String(error) }
    }
  },
})
