import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { regenerateTwoFactorRecoveryCodes } from '@stacksjs/auth'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'

/**
 * A fresh set of recovery codes (#95), replacing every earlier one.
 *
 * Needs a current authenticator code (or an unused recovery code), so a
 * session left open on someone else's machine cannot mint a way past the
 * second factor. The codes are shown once; only their hashes are kept.
 */
export default new Action({
  name: 'Postline Recovery Codes',
  description: 'Replace the two-factor recovery codes, given a current authenticator or recovery code.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      const user = await request.user()
      if (!user) return response.unauthorized('Unauthorized')
      const code = String(request.get('code') ?? '').trim()
      if (!code)
        return response.json({ ok: false, error: 'Enter a code from your authenticator app.', code: 'code_required' }, { status: 422 })
      const codes = await regenerateTwoFactorRecoveryCodes(Number(user.id), code)
      if (!codes)
        return response.json({ ok: false, error: 'That code is not right. Check your authenticator app and try again.', code: 'invalid_code' }, { status: 422 })
      return response.json({ ok: true, data: { recoveryCodes: codes } }, { headers: { 'Cache-Control': 'private, no-store' } })
    }
    catch (error) {
      return actionFailure(error)
    }
  },
})
