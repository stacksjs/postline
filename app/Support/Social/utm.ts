const fields = ['source', 'medium', 'campaign', 'content', 'term'] as const

export type UtmFields = Partial<Record<typeof fields[number], unknown>>

export function addUtmParameters(destination: unknown, values: UtmFields): string {
  const raw = typeof destination === 'string' ? destination.trim() : ''
  if (!raw || raw.length > 4096) throw new Error('Enter a web address of up to 4,096 characters.')
  let url: URL
  try { url = new URL(raw) }
  catch { throw new Error('Enter a complete HTTP or HTTPS address.') }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Enter an HTTP or HTTPS address without a username or password.')

  for (const field of fields) {
    const input = values[field]
    if (input === undefined || input === null) continue
    if (typeof input !== 'string' || input.length > 120) throw new Error(`Use up to 120 characters for ${field}.`)
    const value = input.trim()
    if (value) url.searchParams.set(`utm_${field}`, value)
  }

  if (url.href.length > 4096) throw new Error('The tagged address must fit within 4,096 characters.')
  return url.href
}
