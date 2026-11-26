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

async function post(path: string, body: unknown): Promise<any> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || payload.message || 'The passkey could not be used.')
  return payload
}

function cancelled(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError')
}

async function signIn(): Promise<SignedIn | null> {
  const { ceremony, options } = await post('/api/auth/passkeys/authentication/options', {})
  let credential
  try {
    credential = await startAuthentication(options)
  }
  catch (error) {
    if (cancelled(error)) return null
    throw error
  }
  return await post('/api/auth/passkeys/authentication', { ceremony, credential: authenticationCredentialToJSON(credential) })
}

async function register(): Promise<boolean> {
  const { ceremony, options } = await post('/api/auth/passkeys/registration/options', {})
  let credential
  try {
    credential = await startRegistration(options)
  }
  catch (error) {
    if (cancelled(error)) return false
    if (error instanceof DOMException && error.name === 'InvalidStateError')
      throw new Error('This device already has a passkey for Postline.')
    throw error
  }
  await post('/api/auth/passkeys/registration', { ceremony, credential: registrationCredentialToJSON(credential) })
  return true
}

export const passkeys = { supported: browserSupportsWebAuthn, signIn, register }
