/**
 * The browser half of passkeys, used by the sign-in and Settings pages.
 *
 * The WebAuthn calls and the credential encoding come from the framework's
 * browser entry; this only runs the two round trips each ceremony takes. A
 * cancelled prompt resolves to `null` rather than throwing, since the person
 * simply changed their mind.
 */
import {
  authenticationCredentialToJSON,
  browserSupportsWebAuthn,
  registrationCredentialToJSON,
  startAuthentication,
  startRegistration,
} from '@stacksjs/auth/passkeys-browser'

interface SignedIn { token: string, expires_in?: number }
interface Ceremony<T> { ceremony: string, options: T }

interface PasskeyMessages {
  passkeyStartFailed: string
  passkeyFailed: string
  passkeyRateLimited: string
}

async function post<T>(path: string, body: unknown, failed: string, rateLimited: string): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }).catch(() => { throw new Error(failed) })
  if (!response.ok) throw new Error(response.status === 429 ? rateLimited : failed)
  const payload = await response.json().catch(() => null)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error(failed)
  return payload as T
}

function cancelled(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError')
}

async function signIn(copy: PasskeyMessages): Promise<SignedIn | null> {
  const { ceremony, options } = await post<Ceremony<Parameters<typeof startAuthentication>[0]>>('/api/auth/passkeys/authentication/options', {}, copy.passkeyStartFailed, copy.passkeyRateLimited)
  let credential: ReturnType<typeof authenticationCredentialToJSON>
  try {
    credential = authenticationCredentialToJSON(await startAuthentication(options))
  }
  catch (error) {
    if (cancelled(error)) return null
    throw new Error(copy.passkeyFailed)
  }
  const session = await post<SignedIn>('/api/auth/passkeys/authentication', { ceremony, credential }, copy.passkeyFailed, copy.passkeyRateLimited)
  if (typeof session.token !== 'string' || !session.token) throw new Error(copy.passkeyFailed)
  return session
}

async function register(copy: PasskeyMessages & { passkeyAlreadyOnDevice: string }): Promise<boolean> {
  const { ceremony, options } = await post<Ceremony<Parameters<typeof startRegistration>[0]>>('/api/auth/passkeys/registration/options', {}, copy.passkeyStartFailed, copy.passkeyRateLimited)
  let credential: ReturnType<typeof registrationCredentialToJSON>
  try {
    credential = registrationCredentialToJSON(await startRegistration(options))
  }
  catch (error) {
    if (cancelled(error)) return false
    if (error instanceof DOMException && error.name === 'InvalidStateError')
      throw new Error(copy.passkeyAlreadyOnDevice)
    throw new Error(copy.passkeyFailed)
  }
  await post('/api/auth/passkeys/registration', { ceremony, credential }, copy.passkeyFailed, copy.passkeyRateLimited)
  return true
}

export const passkeys = { supported: browserSupportsWebAuthn, signIn, register }
