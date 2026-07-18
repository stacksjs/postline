import type { SocialProvider } from '../../Support/Social/types'
import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { crosspostProviders } from '../../Services/Social/CrosspostService'
import { postQueue } from '../../Services/Social/QueueService'
import { readUploadedImage } from '../../Support/Social/uploads'

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
    const title = String(request.get('title') || '').trim() || null

    const externalUri = String(request.get('external_uri') || '').trim()
    const externalTitle = String(request.get('external_title') || '').trim()
    const external = externalUri && externalTitle
      ? {
          uri: externalUri,
          title: externalTitle,
          description: String(request.get('external_description') || '').trim() || undefined,
        }
      : null

    const imageAlt = String(request.get('image_alt') || '').trim() || undefined
    const uploadedImage = await readUploadedImage(request.file?.('image'))
    const imageUrl = String(request.get('image_url') || '').trim()
    const image = uploadedImage
      ? { ...uploadedImage, altText: imageAlt }
      : imageUrl
        ? { url: imageUrl, altText: imageAlt }
        : null

    try {
      const data = await postQueue.save({ text, providers, title, scheduledAt, external, image })
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
