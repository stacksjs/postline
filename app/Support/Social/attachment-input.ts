import { workspaceLocale } from '../Localization/workspace'
import { composerMediaText } from './media-messages'
import { readImagesInput } from './image-input'
import { readVideoInput } from './video-input'

const text = composerMediaText(workspaceLocale)

export async function readPostAttachments(request: Parameters<typeof readImagesInput>[0] & Parameters<typeof readVideoInput>[0]) {
  const video = await readVideoInput(request)
  if (!video.ok) return video
  const images = await readImagesInput(request)
  if (!images.ok) return images
  if (video.video && images.images.length)
    return { ok: false as const, error: text('mixedAttachments') }
  return { ok: true as const, images: images.images, video: video.video }
}
