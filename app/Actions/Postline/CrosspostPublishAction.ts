import type { SocialProvider } from '../../Support/Social/types'
import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { crosspost, crosspostProviders } from '../../Services/Social/CrosspostService'
import { persistTempMedia, readUploadedImage, removeTempMedia } from '../../Support/Social/uploads'
import { parseVariantsField } from '../../Support/Social/variants'

export default new Action({
  name: 'Postline Crosspost Publish',
  description: 'Publish a post to one or more connected providers at once.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const text = String(request.get('text') || request.get('body') || '').trim()
    const title = String(request.get('title') || '').trim() || undefined

    const available = new Set<string>(crosspostProviders())
    const providers = String(request.get('providers') || request.get('provider') || '')
      .split(',')
      .map(value => value.trim().toLowerCase())
      .filter(value => available.has(value)) as SocialProvider[]

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

    const imageUrl = String(request.get('image_url') || '').trim()
    const imageAlt = String(request.get('image_alt') || '').trim()

    const media: NonNullable<Parameters<typeof crosspost.publish>[2]>['media'] = []
    let tempMediaFile: string | null = null
    const uploadedImage = await readUploadedImage(request.file?.('image'))
    if (uploadedImage) {
      // Persist briefly so URL-only providers (Instagram/Threads) can fetch the
      // upload server-side; byte-upload providers use the bytes. Removed once
      // publishing finishes (Meta downloads during container creation, so the
      // file is safe to delete by then).
      const temp = await persistTempMedia(uploadedImage.bytes, uploadedImage.mimeType)
      tempMediaFile = temp?.filename ?? null
      media.push({ ...uploadedImage, url: temp?.url, altText: imageAlt || undefined })
    }
    if (imageUrl)
      media.push({ url: imageUrl, altText: imageAlt || undefined })

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
      return response.json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, { status: 422 })
    }
    finally {
      if (tempMediaFile) await removeTempMedia(tempMediaFile)
    }
  },
})
