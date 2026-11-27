import type { SocialProvider } from '../../Support/Social/types'
import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { postPurge } from '../../Services/Social/PurgeService'

function parseProviders(value: unknown): SocialProvider[] | undefined {
  const raw = String(value || '').trim()
  if (!raw) return undefined
  return raw.split(',').map(part => part.trim()).filter(Boolean) as SocialProvider[]
}

/** `older_than_days=7` → 7; blank means no age limit. */
function parseOlderThanDays(value: unknown): number | undefined {
  const raw = String(value ?? '').trim()
  return raw ? Number(raw) : undefined
}

/**
 * Permanently delete posts from the connected social accounts. Irreversible —
 * the caller must send the unused preview token and its confirmation phrase.
 * The token authorizes only the accounts and posts in that preview. The
 * `dry_run=1` flag routes through the preview path.
 */
export default new Action({
  name: 'Postline Purge Run',
  description: 'Permanently delete posts from the connected social accounts.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const scope = String(request.get('scope') || 'tracked') === 'all' ? 'all' : 'tracked'
    const providers = parseProviders(request.get('providers'))
    const olderThanDays = parseOlderThanDays(request.get('older_than_days'))
    const dryRun = ['1', 'true', 'yes'].includes(String(request.get('dry_run') || '').toLowerCase())

    try {
      if (dryRun)
        return response.json({ ok: true, data: await postPurge.preview({ scope, providers, olderThanDays }) })

      // Checked here, before answering; the deleting itself carries on in the
      // background and the page follows it at /purge/status.
      const progress = postPurge.start({
        scope,
        providers,
        olderThanDays,
        confirmation: String(request.get('confirmation') || ''),
        previewToken: String(request.get('preview_token') || ''),
      })
      return response.json({ ok: true, data: progress }, { status: 202 })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
