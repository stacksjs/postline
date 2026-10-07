import type { SocialProvider } from '../../Support/Social/types'
import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { retention } from '../../Services/RetentionService'

function parseBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

/**
 * Save the automatic deletion settings. Switching it on needs
 * `acknowledged=1`: once on, the daily job deletes without asking again.
 */
export default new Action({
  name: 'The Open Times Retention Save',
  description: 'Turn automatic deletion of old posts on or off, and set how long posts are kept.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const providers = request.get('providers')
    const days = request.get('days')

    try {
      const settings = await retention.save({
        enabled: parseBoolean(request.get('enabled')),
        days: days === undefined || days === null || days === '' ? undefined : Number(days),
        providers: providers === undefined || providers === null
          ? undefined
          : String(providers).split(',').map(part => part.trim()).filter(Boolean) as SocialProvider[],
        scope: request.get('scope') ? String(request.get('scope')) : undefined,
        acknowledged: parseBoolean(request.get('acknowledged')) === true,
      })
      return response.json({ ok: true, data: { settings, lastRun: await retention.lastRun() } })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
