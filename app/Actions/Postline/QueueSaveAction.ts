import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { crosspostProviders } from '../../Services/Social/CrosspostService'
import { postQueue } from '../../Services/Social/QueueService'
import { parseTargets, targetKey } from '../../Support/Social/targets'
import { readImagesInput } from '../../Support/Social/image-input'
import { readPostOptions } from '../../Support/Social/post-options'
import { readQueuedThread } from '../../Support/Social/threads'
import { UserFacingError } from '../../Support/Http/user-error'
import { parseVariantsField } from '../../Support/Social/variants'

export default new Action({
  name: 'Postline Queue Save',
  description: 'Save a post as a draft or schedule it for later publishing.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const text = String(request.get('text') || request.get('body') || '').trim()

    // Network names (`bluesky`) and/or account targets (`bluesky:12`).
    const providers = parseTargets(String(request.get('providers') || request.get('provider') || ''), crosspostProviders())
      .map(targetKey)

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

    const imageInput = await readImagesInput(request)
    if (!imageInput.ok)
      return response.json({ ok: false, error: imageInput.error }, { status: 422 })
    const images = imageInput.images

    // Rejected rather than dropped: silently discarding the per-network text
    // would publish the shared body everywhere with no indication why.
    const parsedVariants = parseVariantsField(request.get('variants'))
    if (!parsedVariants.ok)
      return response.json({ ok: false, error: 'Could not read the per-network text.' }, { status: 422 })

    const readOptions = readPostOptions(key => request.get(key))
    if (!readOptions.ok)
      return response.json({ ok: false, error: readOptions.error }, { status: 422 })

    try {
      const texts = readQueuedThread(request.get('thread'))
      if (texts) {
        if (parsedVariants.variants) throw new UserFacingError('Per-network text is available for single posts.')
        const data = await postQueue.saveThread({ texts, providers, scheduledAt, title, external, images, options: readOptions.options })
        return response.json({ ok: true, data })
      }
      const data = await postQueue.save({ text, providers, title, scheduledAt, external, images, options: readOptions.options, variants: parsedVariants.variants })
      return response.json({ ok: true, data })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
