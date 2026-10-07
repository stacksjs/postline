import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { DEFAULT_RETENTION_PROVIDERS, MAX_RETENTION_DAYS, MIN_RETENTION_DAYS, retention } from '../../Services/RetentionService'
import { PURGEABLE_PROVIDERS } from '../../Services/Social/PurgeService'

export default new Action({
  name: 'The Open Times Retention Get',
  description: 'Read the automatic post deletion settings and the last scheduled run.',
  method: 'GET',

  async handle() {
    try {
      return response.json({
        ok: true,
        data: {
          settings: await retention.get(),
          lastRun: await retention.lastRun(),
          purgeableProviders: PURGEABLE_PROVIDERS,
          defaultProviders: DEFAULT_RETENTION_PROVIDERS,
          minDays: MIN_RETENTION_DAYS,
          maxDays: MAX_RETENTION_DAYS,
        },
      })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
