import { countText } from '../../app/Support/Social/count-text'
import { providerLabel } from './networks'

export type ComposerVariants = Record<string, { text: string, shared: string }>

interface ComposerVariantCopy {
  variantCount: string
  variantShared: string
  variantTooLong: string
}

/** Blank overrides inherit the shared post. Keep the editable field separately. */
export function composerVariantsPayload(variants: ComposerVariants): Record<string, string> {
  return Object.fromEntries(Object.entries(variants)
    .filter(([, entry]) => entry.text.trim())
    .map(([provider, entry]) => [provider, entry.text]))
}

export function composerVariantRows(targets: ReadonlyArray<{ provider: string, characterLimit: number }>, variants: ComposerVariants, shared: string, copy: ComposerVariantCopy) {
  return targets.map((target) => {
    const { provider, characterLimit } = target
    const entry = variants[provider]
    const text = entry?.text ?? shared
    const length = countText(provider, text)
    const count = characterLimit ? `${length} / ${characterLimit}` : String(length)
    const name = providerLabel(provider)
    const over = Boolean(characterLimit) && length > characterLimit
    const description = entry
      ? copy.variantCount.replace('{count}', count)
      : `${copy.variantShared}${characterLimit ? ` · ${count}` : ''}${over ? ` · ${copy.variantTooLong.replace('{network}', name)}` : ''}`
    return { provider, name, text, description, over, custom: Boolean(entry), stale: Boolean(entry && entry.shared !== shared) }
  })
}
