/**
 * Read an uploaded image regardless of shape: the router's multipart
 * parser stores raw Web `File` objects on `request.files`, while the
 * typed `FileInfo` contract (`buffer`/`mimetype`) describes the upload
 * middleware's processed form. Accept both.
 */
export async function readUploadedImage(uploaded: unknown): Promise<{ bytes: Uint8Array, mimeType: string } | null> {
  if (!uploaded || typeof uploaded !== 'object') return null
  const candidate = uploaded as { buffer?: ArrayBuffer, mimetype?: string, type?: string, arrayBuffer?: () => Promise<ArrayBuffer> }

  if (candidate.buffer && candidate.buffer.byteLength > 0)
    return { bytes: new Uint8Array(candidate.buffer), mimeType: candidate.mimetype || 'image/jpeg' }

  if (typeof candidate.arrayBuffer === 'function') {
    const buffer = await candidate.arrayBuffer()
    if (buffer.byteLength > 0)
      return { bytes: new Uint8Array(buffer), mimeType: candidate.type || 'image/jpeg' }
  }

  return null
}
