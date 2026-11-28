/** Accept the generated base64 key or a full-length legacy passphrase. */
export function workspaceKeyBytes(key: string | undefined): Buffer | null {
  const value = key?.trim()
  if (!key || !value || value.startsWith('encrypted:')) return null
  if (!value.startsWith('base64:')) return Buffer.byteLength(value) >= 32 ? Buffer.from(key) : null
  if (value !== key) return null

  const encoded = key.slice(7)
  const bytes = Buffer.from(encoded, 'base64')
  return bytes.byteLength >= 32 && bytes.toString('base64') === encoded ? bytes : null
}
