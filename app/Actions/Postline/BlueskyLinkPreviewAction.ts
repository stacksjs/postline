import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { UnsafeUrlError } from '../../Support/Http/safe-fetch'
import { fetchLinkPreview } from '../../Support/Social/link-preview'

export default new Action({
  name: 'Postline Bluesky Link Preview',
  description: 'Fetch Open Graph metadata for a link preview.',
  method: 'GET',

  async handle(request: RequestInstance) {
    try {
      return response.json({ ok: true, data: await fetchLinkPreview(String(request.get('url') || '')) })
    }
    catch (error) {
      // Only messages written for the person who pasted the link are passed
      // on; anything else is a network or parsing failure they cannot act on.
      return response.json({
        ok: false,
        error: error instanceof UnsafeUrlError ? error.message : 'That link could not be previewed.',
      }, { status: 422 })
    }
  },
})
