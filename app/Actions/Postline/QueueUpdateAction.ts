import type { SocialProvider } from '../../Support/Social/types'
import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { crosspostProviders } from '../../Services/Social/CrosspostService'
import { postQueue } from '../../Services/Social/QueueService'
import { readUploadedImage } from '../../Support/Social/uploads'

export default new Action({
  name: 'Postline Queue Update',
  description: 'Edit a draft, scheduled, or failed post in place.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const id = Number(request.get('id') || 0)
    if (!id)
      return response.json({ ok: false, error: 'Post id is required.' }, { status: 422 })

    const text = String(request.get('text') || request.get('body') || '').trim()
    const available = new Set<string>(crosspostProviders())
    const providers = String(request.get('providers') || '')
      .split(',')
      .map(value => value.trim().toLowerCase())
      .filter(value => available.has(value)) as SocialProvider[]

    const scheduledAt = String(request.get('scheduled_at') || '').trim() || null
    const title = String(request.get('title') || '').trim() || null

    const externalUri = String(request.get('external_uri') || '').trim()
    const externalTitle = String(request.get('external_title') || '').trim()
    const external = externalUri && externalTitle
      ? { uri: externalUri, title: externalTitle, description: String(request.get('external_description') || '').trim() || undefined }
      : null

    // Image tri-state: a new upload/url replaces; `remove_image=1` clears;
    // otherwise (undefined) the stored image is kept.
    const imageAlt = String(request.get('image_alt') || '').trim() || undefined
    const uploaded = await readUploadedImage(request.file?.('image'))
    const imageUrl = String(request.get('image_url') || '').trim()
    const removeImage = String(request.get('remove_image') || '') === '1'
    const image = uploaded
      ? { ...uploaded, altText: imageAlt }
      : imageUrl
        ? { url: imageUrl, altText: imageAlt }
        : removeImage
          ? null
          : undefined

    try {
      const data = await postQueue.update(id, { text, providers, title, scheduledAt, external, image })
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
