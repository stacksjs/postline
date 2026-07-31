import type { SocialProvider } from '../../Support/Social/types'
import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { postPurge, PURGE_CONFIRMATION, PURGEABLE_PROVIDERS } from '../../Services/Social/PurgeService'

/** `?providers=bluesky,twitter` → a typed list; empty means "all purgeable". */
function parseProviders(value: unknown): SocialProvider[] | undefined {
  const raw = String(value || '').trim()
  if (!raw) return undefined
  return raw.split(',').map(part => part.trim()).filter(Boolean) as SocialProvider[]
}

export default new Action({
  name: 'Postline Purge Preview',
  description: 'Count what a bulk post deletion would remove, without deleting anything.',
  method: 'GET',

  async handle(request: RequestInstance) {
    const scope = String(request.get('scope') || 'tracked') === 'all' ? 'all' : 'tracked'

    try {
      const result = await postPurge.preview({
        scope,
        providers: parseProviders(request.get('providers')),
      })

      return response.json({
        ok: true,
        data: {
          ...result,
          confirmation: PURGE_CONFIRMATION,
          purgeableProviders: PURGEABLE_PROVIDERS,
        },
      })
    }
    catch (error) {
      return response.json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, { status: 422 })
    }
  },
})
