/**
 * Network tokens are stored encrypted.
 *
 * A token is what lets Postline post as someone. Stored in the clear, a copy
 * of the database file, a backup or a stray query log is enough to post as
 * them. Sealed, the file alone is not: the key is the app key, which lives in
 * the environment (and, for the Mac app, outside the database file).
 *
 * A sealed value carries a marker in front of the ciphertext so the two forms
 * can always be told apart. That is what makes the upgrade safe: a row written
 * before this existed is still plain, `openToken` passes it through, and
 * `sealStoredTokens` in `identities.ts` rewrites it the first time the table
 * is touched.
 */
import process from 'node:process'
import { decrypt, encrypt } from '@stacksjs/security'

const MARKER = 'enc:v1:'

export function isSealed(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(MARKER)
}

function requireKey(): void {
  if (!String(process.env.APP_KEY || '').trim()) {
    // Shown in Channels, so it names the fix rather than the variable; the
    // key itself is described in docs/self-hosting.md.
    throw new Error('This Postline has no encryption key yet, so it cannot save network sign-ins. On the machine it runs on, run `./buddy key:generate`, then connect again.')
  }
}

/** Seal a token for storage. Empty stays empty; an already sealed value is left as it is. */
export async function sealToken(value: string | null | undefined): Promise<string | null> {
  if (value === null || value === undefined || value === '')
    return null
  if (isSealed(value))
    return value

  requireKey()
  return `${MARKER}${await encrypt(value)}`
}

/** Read a stored token. A value written before tokens were sealed is returned as it is. */
export async function openToken(value: string | null | undefined): Promise<string | null> {
  if (value === null || value === undefined || value === '')
    return null
  if (!isSealed(value))
    return value

  requireKey()
  try {
    return await decrypt(value.slice(MARKER.length))
  }
  catch {
    // Sealed with a key this install no longer has. The account has to be
    // reconnected; returning the ciphertext as if it were a token would send
    // it to a network.
    throw new Error('A saved sign-in for this account could not be read: the encryption key changed after it was saved. Reconnect the account in Channels.')
  }
}
