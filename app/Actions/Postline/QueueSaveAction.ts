import type { SocialProvider } from '../../Support/Social/types'
import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { crosspostProviders } from '../../Services/Social/CrosspostService'
import { postQueue } from '../../Services/Social/QueueService'

export default new Action({
  name: 'Postline Queue Save',
  description: 'Save a post as a draft or schedule it for later publishing.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const text = String(request.get('text') || request.get('body') || '').trim()

    const available = new Set<string>(crosspostProviders())
    const providers = String(request.get('providers') || request.get('provider') || '')
      .split(',')
      .map(value => value.trim().toLowerCase())
      .filter(value => available.has(value)) as SocialProvider[]

    const scheduledAt = String(request.get('scheduled_at') || '').trim() || null

    try {
      const data = await postQueue.save({ text, providers, scheduledAt })
      return response.json({ ok: true, data })
    }
    catch (error) {
      return response.json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, { status: 422 })
    }
  },
})
