import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { crosspost, crosspostProviders } from '../../Services/Social/CrosspostService'
import { parseTargets } from '../../Support/Social/targets'
import { readImagesInput } from '../../Support/Social/image-input'
import { mediaObjections } from '../../Support/Social/media-rules'
import { persistTempMedia, removeTempMedia } from '../../Support/Social/uploads'
import { parseVariantsField } from '../../Support/Social/variants'

export default new Action({
  name: 'Postline Crosspost Publish',
  description: 'Publish a post to one or more connected providers at once.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const text = String(request.get('text') || request.get('body') || '').trim()
    const title = String(request.get('title') || '').trim() || undefined

    // Network names (`bluesky`) and/or account targets (`bluesky:12`); two
    // accounts on one network are two targets.
    const providers = parseTargets(String(request.get('providers') || request.get('provider') || ''), crosspostProviders())

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

    const imageInput = await readImagesInput(request)
    if (!imageInput.ok)
      return response.json({ ok: false, error: imageInput.error }, { status: 422 })

    // Refused before anything is sent, naming the network that objects.
    const objections = mediaObjections(providers.map(target => target.provider), imageInput.images.map(image => image.bytes?.length ? { bytes: image.bytes.length, mimeType: image.mimeType } : {}))
    if (objections.length)
      return response.json({ ok: false, error: `${objections.join(' ')} Use a different image, or leave that network out.` }, { status: 422 })

    const media: NonNullable<Parameters<typeof crosspost.publish>[2]>['media'] = []
    const tempMediaFiles: string[] = []
    for (const image of imageInput.images) {
      if (image.bytes?.length) {
        // Persist briefly so URL-only providers (Instagram/Threads) can fetch
        // the upload server-side; byte-upload providers use the bytes.
        // Removed once publishing finishes (Meta downloads during container
        // creation, so the file is safe to delete by then).
        const temp = await persistTempMedia(image.bytes, image.mimeType || 'image/jpeg')
        if (temp?.filename) tempMediaFiles.push(temp.filename)
        media.push({ bytes: image.bytes, mimeType: image.mimeType, url: temp?.url, altText: image.altText })
      }
      else if (image.url) {
        media.push({ url: image.url, altText: image.altText })
      }
    }

    // Optional multi-segment thread: JSON array of post texts. Segments are
    // reply-chained on providers that support it (Bluesky).
    let thread: string[] = []
    try {
      const parsed = JSON.parse(String(request.get('thread') || '[]'))
      if (Array.isArray(parsed)) thread = parsed.map(value => String(value).trim()).filter(Boolean)
    }
    catch {}

    try {
      // Validated inside the try so the temp-media `finally` still runs on the
      // early return. Rejected rather than dropped: silently ignoring the
      // per-network text would publish the shared body everywhere instead.
      const parsedVariants = parseVariantsField(request.get('variants'))
      if (!parsedVariants.ok)
        return response.json({ ok: false, error: 'Could not read the per-network text.' }, { status: 422 })

      const content = {
        title,
        external,
        media: media.length ? media : undefined,
        variants: parsedVariants.variants || undefined,
      }
      const data = thread.length > 1
        ? await crosspost.publishThread(thread, providers, content)
        : await crosspost.publish(thread[0] || text, providers, content)
      // Surface a partial-failure (some targets failed) as a 207-style payload
      // while still returning 200 so the client can report per-provider state.
      const allFailed = data.results.length > 0 && data.results.every(result => !result.ok)
      return response.json({ ok: !allFailed, data }, { status: allFailed ? 422 : 200 })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
    finally {
      for (const file of tempMediaFiles) await removeTempMedia(file)
    }
  },
})
