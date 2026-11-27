/**
 * Which server holds a Bluesky account.
 *
 * Bluesky is one app on a network of servers. Most accounts live on
 * `bsky.social`, but an account can live on any server, and every request
 * for that account (signing in, posting, deleting) has to go to its own.
 * Postline sent everything to `bsky.social`, so an account anywhere else
 * could not even sign in.
 *
 * The server is found the way the network defines it: a handle resolves to
 * an identifier (a DID), and the DID's document names the server. Nothing is
 * stored: the answer is remembered for an hour and looked up again.
 */
import { safeFetch } from '../Http/safe-fetch'

export const DEFAULT_BLUESKY_SERVER = 'https://bsky.social'

/** Fetch a small text document, or null when it cannot be had. */
export type TextGetter = (url: string) => Promise<string | null>

/** Guarded: a handle is typed by a person and names a host to fetch from. */
const guardedGet: TextGetter = async (url) => {
  try {
    const result = await safeFetch(url, { timeoutMs: 5_000, maxBytes: 100_000, headers: { accept: 'application/json, text/plain' } })
    if (result.status < 200 || result.status >= 300 || result.truncated) return null
    return new TextDecoder().decode(result.bytes)
  }
  catch {
    return null
  }
}

function parseJson(text: string | null): any {
  if (!text) return null
  try {
    return JSON.parse(text)
  }
  catch {
    return null
  }
}

const HANDLE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i

/** The DID a handle belongs to, or null. A DID is returned as it is. */
export async function resolveBlueskyDid(identifier: string, get: TextGetter = guardedGet): Promise<string | null> {
  const value = identifier.trim().replace(/^@/, '')
  if (value.startsWith('did:')) return value
  // An email address signs in at the default server; it names no account server.
  if (!HANDLE.test(value)) return null

  // The handle's own domain says who it is…
  const own = (await get(`https://${value}/.well-known/atproto-did`))?.trim()
  if (own?.startsWith('did:') && !/\s/.test(own)) return own

  // …and failing that (a DNS-only handle), the network's public resolver does.
  const resolved = parseJson(await get(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(value)}`))
  return typeof resolved?.did === 'string' && resolved.did.startsWith('did:') ? resolved.did : null
}

interface DidDocument {
  id?: string
  service?: Array<{ id?: string, type?: string, serviceEndpoint?: string }>
}

/** The server named in a DID's document, or null. */
export async function resolvePdsOfDid(did: string, get: TextGetter = guardedGet): Promise<string | null> {
  let documentUrl: string
  if (/^did:plc:[a-z0-9]+$/.test(did)) {
    documentUrl = `https://plc.directory/${did}`
  }
  else if (did.startsWith('did:web:') && HANDLE.test(did.slice('did:web:'.length))) {
    documentUrl = `https://${did.slice('did:web:'.length)}/.well-known/did.json`
  }
  else {
    return null
  }

  const document: DidDocument | null = parseJson(await get(documentUrl))
  if (document?.id !== did || !Array.isArray(document.service)) return null
  const pds = document.service.find(service =>
    service?.type === 'AtprotoPersonalDataServer' && (service.id === '#atproto_pds' || service.id === `${did}#atproto_pds`),
  )
  if (typeof pds?.serviceEndpoint !== 'string') return null
  const endpoint = URL.parse(pds.serviceEndpoint)
  if (endpoint?.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash)
    return null
  return endpoint.origin
}

const remembered = new Map<string, { server: string, expiresAt: number }>()
const SERVICE_TTL_MS = 60 * 60 * 1000
const FALLBACK_TTL_MS = 60 * 1000

/**
 * The server to talk to for a handle or DID. Falls back to the default when
 * it cannot be worked out: for nearly every account that is the right
 * answer, and for the rest the sign-in then fails with the server's own
 * message instead of with a lookup error.
 */
export async function resolveBlueskyServer(identifier: string | null | undefined, get: TextGetter = guardedGet): Promise<string> {
  const value = String(identifier || '').trim().replace(/^@/, '')
  const key = value.startsWith('did:') ? value : value.toLowerCase()
  if (!key) return DEFAULT_BLUESKY_SERVER
  const known = remembered.get(key)
  if (known && Date.now() < known.expiresAt) return known.server

  const did = await resolveBlueskyDid(key, get)
  const pds = did ? await resolvePdsOfDid(did, get) : null
  const server = pds ?? DEFAULT_BLUESKY_SERVER
  remembered.set(key, { server, expiresAt: Date.now() + (pds ? SERVICE_TTL_MS : FALLBACK_TTL_MS) })
  return server
}

/** For tests. */
export function forgetBlueskyServers(): void {
  remembered.clear()
}
