/**
 * Fetching a URL that a caller chose.
 *
 * Postline fetches two kinds of caller-supplied URL: a link to preview, and an
 * image to attach by address. Both used a bare `fetch`, which will happily
 * call the machine's own loopback services, a cloud metadata endpoint or a
 * router's admin page, follow a redirect to any of those, wait as long as the
 * other end likes, and read a body of any size into memory.
 *
 * `safeFetch` refuses anything that is not plain http(s) to a public address,
 * re-checks every redirect hop, and enforces one deadline and one size cap
 * over the whole exchange.
 *
 * One gap is left open knowingly: the address is checked when the name is
 * resolved, and `fetch` resolves it again to connect, so a DNS answer that
 * changes between the two is not caught. Closing it needs the connection made
 * to the address that was checked, which `fetch` does not offer.
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export class UnsafeUrlError extends Error {}

const MAX_REDIRECTS = 3

function ipv4Octets(address: string): number[] | null {
  const parts = address.split('.')
  if (parts.length !== 4)
    return null
  const octets = parts.map(Number)
  return octets.every(n => Number.isInteger(n) && n >= 0 && n <= 255) ? octets : null
}

/** Loopback, private, link-local, carrier-grade NAT, multicast and reserved ranges. */
function isPrivateIpv4(address: string): boolean {
  const octets = ipv4Octets(address)
  if (!octets)
    return true
  const [a, b] = octets as [number, number, number, number]

  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase().split('%')[0] || ''
  if (lower === '::' || lower === '::1')
    return true

  // IPv4-mapped (`::ffff:10.0.0.1`) and NAT64 addresses carry an IPv4 address.
  const embedded = lower.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (embedded)
    return isPrivateIpv4(embedded[1] as string)
  if (lower.startsWith('::ffff:') || lower.startsWith('64:ff9b:'))
    return true

  const first = Number.parseInt(lower.split(':')[0] || '0', 16)
  // fc00::/7 unique local, fe80::/10 link-local, ff00::/8 multicast.
  return (first & 0xFE00) === 0xFC00 || (first & 0xFFC0) === 0xFE80 || (first & 0xFF00) === 0xFF00
}

export function isPrivateAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4)
    return isPrivateIpv4(address)
  if (version === 6)
    return isPrivateIpv6(address)
  return true
}

type Resolver = (hostname: string) => Promise<string[]>

const systemResolver: Resolver = async (hostname) => {
  const answers = await lookup(hostname, { all: true })
  return answers.map(answer => answer.address)
}

/**
 * Parse and vet a URL. Throws `UnsafeUrlError` with a message that is safe to
 * show the person who supplied it.
 */
export async function assertPublicHttpUrl(value: string, resolve: Resolver = systemResolver): Promise<URL> {
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    throw new UnsafeUrlError('That is not a valid web address.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new UnsafeUrlError('Only http and https addresses can be used.')
  if (url.username || url.password)
    throw new UnsafeUrlError('Addresses with a username or password cannot be used.')

  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const lower = hostname.toLowerCase()
  if (!lower || lower === 'localhost' || /\.(?:localhost|local|internal|lan|home|test)$/.test(lower))
    throw new UnsafeUrlError('That address is not on the public internet.')

  let addresses: string[]
  if (isIP(hostname)) {
    addresses = [hostname]
  }
  else {
    try {
      addresses = await resolve(hostname)
    }
    catch {
      throw new UnsafeUrlError('That address could not be found.')
    }
  }

  if (addresses.length === 0 || addresses.some(isPrivateAddress))
    throw new UnsafeUrlError('That address is not on the public internet.')

  return url
}

export interface SafeFetchOptions {
  /** Deadline for the whole exchange, body included. */
  timeoutMs: number
  /** Hard cap on the body, enforced while reading. */
  maxBytes: number
  headers?: Record<string, string>
  /** Injected in tests. */
  fetcher?: typeof fetch
  resolve?: Resolver
}

export interface SafeFetchResult {
  url: URL
  status: number
  contentType: string
  bytes: Uint8Array
  /** True when the body was longer than `maxBytes` and was cut there. */
  truncated: boolean
}

async function readCapped(response: Response, maxBytes: number): Promise<{ bytes: Uint8Array, truncated: boolean }> {
  const reader = response.body?.getReader()
  if (!reader)
    return { bytes: new Uint8Array(), truncated: false }

  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  while (true) {
    const { done, value } = await reader.read()
    if (done)
      break
    if (total + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - total))
      total = maxBytes
      truncated = true
      await reader.cancel().catch(() => {})
      break
    }
    chunks.push(value)
    total += value.byteLength
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { bytes, truncated }
}

/** Fetch a caller-supplied URL. Throws `UnsafeUrlError` when it, or a redirect from it, is refused. */
export async function safeFetch(value: string, options: SafeFetchOptions): Promise<SafeFetchResult> {
  const fetcher = options.fetcher ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)

  try {
    let url = await assertPublicHttpUrl(value, options.resolve)

    for (let hop = 0; ; hop++) {
      const response = await fetcher(url, {
        headers: options.headers,
        redirect: 'manual',
        signal: controller.signal,
      })

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        await response.body?.cancel().catch(() => {})
        if (!location)
          throw new UnsafeUrlError('That address redirected nowhere.')
        if (hop >= MAX_REDIRECTS)
          throw new UnsafeUrlError('That address redirected too many times.')
        url = await assertPublicHttpUrl(new URL(location, url).toString(), options.resolve)
        continue
      }

      const { bytes, truncated } = await readCapped(response, options.maxBytes)
      return {
        url,
        status: response.status,
        contentType: (response.headers.get('content-type') || '').split(';')[0]?.trim().toLowerCase() || '',
        bytes,
        truncated,
      }
    }
  }
  catch (error) {
    if (controller.signal.aborted)
      throw new UnsafeUrlError('That address took too long to answer.')
    throw error
  }
  finally {
    clearTimeout(timer)
  }
}
