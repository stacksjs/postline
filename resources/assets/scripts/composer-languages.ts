/** Common languages, named in the reader's own language, with their language first. */
export function composerLanguages(language: string): Array<{ value: string, label: string }> {
  const codes = ['en', 'es', 'de', 'fr', 'pt', 'pt-BR', 'it', 'nl', 'sv', 'pl', 'tr', 'ru', 'uk', 'ar', 'hi', 'ja', 'ko', 'zh']
  const own = language.split('-')[0]
  const ordered = own && codes.includes(own) ? [own, ...codes.filter(code => code !== own)] : codes
  let names: Intl.DisplayNames | undefined
  try {
    names = new Intl.DisplayNames([language || 'en'], { type: 'language' })
  }
  catch {}
  return [{ value: '', label: 'Not set' }, ...ordered.map(code => ({ value: code, label: names?.of(code) || code }))]
}
