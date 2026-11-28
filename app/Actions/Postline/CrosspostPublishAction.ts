import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { UserFacingError } from '../../Support/Http/user-error'
import { workspaceComposerErrors, workspaceLocale } from '../../Support/Localization/workspace'
import { crosspost, crosspostProviders } from '../../Services/Social/CrosspostService'
import { parseTargets } from '../../Support/Social/targets'
import { readPostAttachments } from '../../Support/Social/attachment-input'
import { composerMediaText } from '../../Support/Social/media-messages'
import { mediaObjections } from '../../Support/Social/media-rules'
import { readPostOptions } from '../../Support/Social/post-options'
import { readThreadInput } from '../../Support/Social/threads'
import { persistTempMedia, removeTempMedia } from '../../Support/Social/uploads'
import { parseVariantsField } from '../../Support/Social/variants'

const mediaText = composerMediaText(workspaceLocale)

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

    const attachments = await readPostAttachments(request)
    if (!attachments.ok)
      return response.json({ ok: false, error: attachments.error }, { status: 422 })

    // Refused before anything is sent, naming the network that objects.
    const objections = mediaObjections(providers.map(target => target.provider), attachments.images.map(image => image.bytes?.length ? { bytes: image.bytes.length, mimeType: image.mimeType } : {}), workspaceLocale)
    if (objections.length)
      return response.json({ ok: false, error: `${objections.join(' ')} ${mediaText('chooseOtherImage')}` }, { status: 422 })

    const tempMediaFiles: string[] = []
    try {
      const thread = (readThreadInput(request.get('thread')) ?? []).map(segment => segment.trim())
      if (thread.some(segment => !segment)) throw new UserFacingError(workspaceComposerErrors.invalidThread)

      const parsedVariants = parseVariantsField(request.get('variants'))
      if (!parsedVariants.ok)
        throw new UserFacingError(workspaceComposerErrors.invalidVariants)
      if (thread.length > 1 && parsedVariants.variants)
        throw new UserFacingError(workspaceComposerErrors.variantsSingleOnly)

      const readOptions = readPostOptions(key => request.get(key))
      if (!readOptions.ok)
        return response.json({ ok: false, error: readOptions.error }, { status: 422 })

      const media: NonNullable<Parameters<typeof crosspost.publish>[2]>['media'] = []
      for (const image of attachments.images) {
        if (image.bytes?.length) {
          // URL-only providers fetch the temporary upload during publishing.
          const temp = await persistTempMedia(image.bytes, image.mimeType || 'image/jpeg')
          if (temp?.filename) tempMediaFiles.push(temp.filename)
          media.push({ bytes: image.bytes, mimeType: image.mimeType, url: temp?.url, altText: image.altText })
        }
        else if (image.url) {
          media.push({ url: image.url, altText: image.altText })
        }
      }

      const content = {
        title,
        external,
        media: media.length ? media : undefined,
        video: attachments.video ?? undefined,
        variants: parsedVariants.variants || undefined,
        options: readOptions.options,
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
