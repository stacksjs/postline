import type { VariantMap } from '../../Support/Social/variants'
import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { crosspostProviders } from '../../Services/Social/CrosspostService'
import { postQueue } from '../../Services/Social/QueueService'
import { parseTargets, targetKey } from '../../Support/Social/targets'
import { readPostAttachments } from '../../Support/Social/attachment-input'
import { POST_OPTION_FIELDS, readPostOptions } from '../../Support/Social/post-options'
import { parseVariantsField } from '../../Support/Social/variants'
import { readQueuedThread } from '../../Support/Social/threads'
import { UserFacingError } from '../../Support/Http/user-error'

export default new Action({
  name: 'Postline Queue Update',
  description: 'Edit a draft, scheduled, or failed post in place.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const id = Number(request.get('id') || 0)
    if (!id)
      return response.json({ ok: false, error: 'Post id is required.' }, { status: 422 })

    const text = String(request.get('text') || request.get('body') || '').trim()
    // Network names (`bluesky`) and/or account targets (`bluesky:12`).
    const providers = parseTargets(String(request.get('providers') || ''), crosspostProviders())
      .map(targetKey)

    const scheduledAt = String(request.get('scheduled_at') || '').trim() || null
    const title = String(request.get('title') || '').trim() || null

    const externalUri = String(request.get('external_uri') || '').trim()
    const externalTitle = String(request.get('external_title') || '').trim()
    const external = externalUri && externalTitle
      ? { uri: externalUri, title: externalTitle, description: String(request.get('external_description') || '').trim() || undefined }
      : null

    // Uploaded media and image addresses replace the existing attachment.
    // An explicit removal clears it, and omission keeps it.
    const attachments = await readPostAttachments(request)
    if (!attachments.ok)
      return response.json({ ok: false, error: attachments.error }, { status: 422 })
    const removeMedia = String(request.get('remove_media') || request.get('remove_image') || '') === '1'
    const images = attachments.images.length
      ? attachments.images
      : removeMedia
        ? null
        : undefined

    // Variants tri-state, mirroring the images above: an omitted field
    // keeps what is stored, a submitted-but-empty one clears. A malformed one
    // is rejected rather than treated as empty — clearing every stored override
    // is destructive and must never be the result of a payload we misread.
    const rawVariants = request.get('variants')
    let variants: VariantMap | null | undefined
    if (rawVariants === undefined || rawVariants === null) {
      variants = undefined
    }
    else {
      const parsed = parseVariantsField(rawVariants)
      if (!parsed.ok)
        return response.json({ ok: false, error: 'Could not read the per-network text.' }, { status: 422 })
      variants = parsed.variants
    }

    // Sent by the composer on every edit; another client that leaves them
    // all out keeps what is stored.
    const sendsOptions = POST_OPTION_FIELDS.some(key => request.get(key) !== undefined && request.get(key) !== null)
    const readOptions = readPostOptions(key => request.get(key))
    if (!readOptions.ok)
      return response.json({ ok: false, error: readOptions.error }, { status: 422 })

    try {
      const texts = readQueuedThread(request.get('thread'))
      if (texts && variants) throw new UserFacingError('Per-network text is available for single posts.')
      const options = sendsOptions ? (readOptions.options ?? null) : undefined
      const input = { text, providers, title, scheduledAt, external, images, video: attachments.video ?? undefined, variants, options }
      const data = String(request.get('next_slot') || '') === '1'
        ? await postQueue.enqueueAtNextSlot({ ...input, texts: texts ?? undefined }, id)
        : texts ? await postQueue.updateThread(id, { ...input, texts }) : await postQueue.update(id, input)
      return response.json({ ok: true, data })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
