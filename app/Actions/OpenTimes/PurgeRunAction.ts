import type { SocialProvider } from '../../Support/Social/types'
import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { postPurge, PURGE_CONFIRMATION } from '../../Services/Social/PurgeService'

function parseProviders(value: unknown): SocialProvider[] | undefined {
  const raw = String(value || '').trim()
  if (!raw) return undefined
  return raw.split(',').map(part => part.trim()).filter(Boolean) as SocialProvider[]
}

/**
 * Permanently delete posts from the connected social accounts. Irreversible —
 * the caller must send the exact confirmation phrase, and `dry_run=1` still
 * routes through the preview path so a mis-wired client can't delete by
 * accident.
 */
export default new Action({
  name: 'The Open Times Purge Run',
  description: 'Permanently delete posts from the connected social accounts.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const scope = String(request.get('scope') || 'tracked') === 'all' ? 'all' : 'tracked'
    const providers = parseProviders(request.get('providers'))
    const dryRun = ['1', 'true', 'yes'].includes(String(request.get('dry_run') || '').toLowerCase())

    try {
      const result = dryRun
        ? await postPurge.preview({ scope, providers })
        : await postPurge.purge({
            scope,
            providers,
            confirmation: String(request.get('confirmation') || ''),
          })

      return response.json({ ok: true, data: { ...result, confirmation: PURGE_CONFIRMATION } })
    }
    catch (error) {
      return response.json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, { status: 422 })
    }
  },
})
