import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { Auth, authCookieForBrowserSession, displayNameMessage, displayNameProblem, normalizeAuthEmail, normalizeDisplayName } from '@stacksjs/auth'
import { db } from '@stacksjs/database'
import { response } from '@stacksjs/router'
import { makeHash } from '@stacksjs/security'
import { actionFailure } from '../../Support/Http/action-error'
import { isMarketingSite } from '../../Support/Marketing/site'

const database = db as any

function workspaceOwned() {
  return response.json({ ok: false, error: 'This workspace already has an account. Sign in instead.' }, { status: 403 })
}

/**
 * First-run registration belongs to a self-hosted workspace. The public
 * marketing server must keep its account unavailable to visitors even when
 * its database is brand new.
 */
export default new Action({
  name: 'Postline Register First User',
  description: 'Create the workspace account — only available on first run.',
  method: 'POST',

  async handle(request: RequestInstance) {
    if (isMarketingSite()) {
      return response.json({
        ok: false,
        error: 'Registration is available on your own Postline install.',
      }, { status: 403 })
    }

    const existing = await database
      .selectFrom('users')
      .select(['id'])
      .executeTakeFirst()

    if (existing) return workspaceOwned()

    const email = normalizeAuthEmail(String(request.get('email') || ''))
    const password = String(request.get('password') || '')
    const name = String(request.get('name') || '').trim()

    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return response.json({ ok: false, error: 'Email must be a valid email address.' }, { status: 422 })
    if (password.length < 8 || password.length > 255)
      return response.json({ ok: false, error: 'Password must be between 8 and 255 characters.' }, { status: 422 })
    if (name.length < 2 || name.length > 255)
      return response.json({ ok: false, error: 'Name must be between 2 and 255 characters.' }, { status: 422 })
    const nameProblem = displayNameProblem(name)
    if (nameProblem && nameProblem !== 'too_short')
      return response.json({ ok: false, error: displayNameMessage(nameProblem) }, { status: 422 })

    try {
      const hashedPassword = await makeHash(password, { algorithm: 'bcrypt' })
      // The emptiness check and insert share a single SQLite write so even
      // overlapping server processes can award the workspace only once.
      const created = await database.unsafe(`
        INSERT INTO users (email, password, name)
        SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)
        RETURNING id
      `, [email, hashedPassword, normalizeDisplayName(name)]).execute() as Array<{ id: number }>
      const owner = created[0]
      if (!owner) return workspaceOwned()

      const result = await Auth.loginUsingId(Number(owner.id), { name: 'user-auth-token' })
      if (!result)
        throw new Error('Registration failed.')

      // The token also goes out as the httpOnly session cookie, exactly as
      // the framework's LoginAction does it. Returning it only in the body
      // left first-run registration unable to sign the new owner in: the page
      // cannot write that cookie itself, so the account was created and the
      // browser was bounced straight back to /login (#45).
      const { expiresIn, token } = result
      const headers = expiresIn
        ? { 'Set-Cookie': authCookieForBrowserSession(token, expiresIn) }
        : undefined

      return response.json({
        ok: true,
        data: {
          access_token: token,
          token_type: 'Bearer',
          expires_in: expiresIn,
        },
      }, headers ? { headers } : undefined)
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
