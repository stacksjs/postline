import type { ComposerImage } from '../../functions/composer-media'
import { composerFileError, composerVideoError, isComposerVideo } from '../../functions/composer-media'

export { composerMediaWarnings } from '../../functions/composer-media'

let nextId = 0

export function prepareAttachments(files: readonly File[], current: readonly ComposerImage[]) {
  const video = files.some(isComposerVideo)
  const keep = video ? [] : current.filter(item => !item.kept && !item.video)
  const error = video ? composerVideoError(files) : composerFileError(files, keep.length)
  if (error) return { error, items: null }
  const added = files.map(file => ({
    id: String(++nextId), file, name: file.name, alt: '', preview: URL.createObjectURL(file), video,
  }))
  return { error: '', items: [...keep, ...added] }
}
