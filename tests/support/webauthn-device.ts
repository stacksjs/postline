/**
 * A software passkey for tests: a real P-256 key, `none` attestation and
 * signed assertions, so the server's ceremony runs exactly as it does for a
 * browser. Adapted from the framework's own auth tests.
 */
import { Buffer } from 'node:buffer'
import { generateKeyPairSync, sign } from 'node:crypto'

function cbor(value: unknown): Buffer {
  const header = (major: number, n: number): Buffer => n < 24
    ? Buffer.from([major * 32 + n])
    : n < 256 ? Buffer.from([major * 32 + 24, n]) : Buffer.from([major * 32 + 25, n >> 8, n & 255])
  if (typeof value === 'number') return header(value < 0 ? 1 : 0, value < 0 ? -1 - value : value)
  if (typeof value === 'string') return Buffer.concat([header(3, Buffer.byteLength(value)), Buffer.from(value)])
  if (value instanceof Uint8Array) return Buffer.concat([header(2, value.length), value])
  if (value instanceof Map) return Buffer.concat([header(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])])
  throw new Error('webauthn-device: unsupported CBOR value')
}

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url')

/** A passkey for `origin`, answering whatever challenge the server sets. */
export async function softwarePasskey(origin: string) {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = pair.publicKey.export({ format: 'jwk' })
  const publicKey = cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, 'base64url')], [-3, Buffer.from(jwk.y!, 'base64url')]]))
  const id = crypto.getRandomValues(new Uint8Array(32))
  const rpHash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(new URL(origin).hostname)))
  const clientData = (type: string, challenge: string): Buffer => Buffer.from(JSON.stringify({ type, origin, challenge }))
  const authData = (flags: number, counter: number): Buffer => {
    const count = Buffer.alloc(4)
    count.writeUInt32BE(counter)
    return Buffer.concat([rpHash, Buffer.from([flags]), count])
  }
  let counter = 0

  return {
    /** The credential JSON a browser sends after `navigator.credentials.create`. */
    register(challenge: string) {
      const size = Buffer.alloc(2)
      size.writeUInt16BE(id.length)
      const attestation = cbor(new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', Buffer.concat([authData(0x45, 0), Buffer.alloc(16), size, id, publicKey])],
      ]))
      return {
        id: b64(id),
        rawId: b64(id),
        type: 'public-key',
        response: { clientDataJSON: b64(clientData('webauthn.create', challenge)), attestationObject: b64(attestation), transports: ['internal'] },
      }
    },
    /** The credential JSON a browser sends after `navigator.credentials.get`. */
    assert(challenge: string, userHandle: string | null = null) {
      counter += 1
      const client = clientData('webauthn.get', challenge)
      const data = authData(0x05, counter)
      const hash = new Bun.CryptoHasher('sha256').update(client).digest()
      return {
        id: b64(id),
        rawId: b64(id),
        type: 'public-key',
        response: {
          clientDataJSON: b64(client),
          authenticatorData: b64(data),
          signature: b64(sign('sha256', Buffer.concat([data, hash]), pair.privateKey)),
          userHandle,
        },
      }
    },
  }
}
