import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { bluesky } from '../../Services/Social/BlueskyService'

export default new Action({
  name: 'Postline Bluesky Publish',
  description: 'Publish a post to Bluesky immediately.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const text = String(request.get('text') || request.get('body') || '').trim()
    const externalUri = String(request.get('external_uri') || '').trim()
    const externalTitle = String(request.get('external_title') || '').trim()
    const externalDescription = String(request.get('external_description') || '').trim()
    const external = externalUri && externalTitle
      ? {
          uri: externalUri,
          title: externalTitle,
          description: externalDescription || undefined,
        }
      : undefined

    try {
      const data = await bluesky.publishNow(text, external)
      return response.json({ ok: true, data })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
