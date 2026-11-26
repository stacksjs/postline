import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { getTwoFactorState, remainingTwoFactorRecoveryCodes } from '@stacksjs/auth'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'

/**
 * How the owner can sign in (#95): whether an authenticator app is required
 * after the password, and how many recovery codes are left. Passkeys are
 * listed by the framework's own `/auth/passkeys`.
 */
export default new Action({
  name: 'Postline Sign-in Security',
  description: 'Whether two-factor sign-in is on and how many recovery codes remain. Never a secret or a code.',
  method: 'GET',

  async handle(request: RequestInstance) {
    try {
      const user = await request.user()
      if (!user) return response.unauthorized('Unauthorized')
      const id = Number(user.id)
      const { enabled } = await getTwoFactorState(id)
      return response.json(
        { ok: true, data: { twoFactor: enabled, recoveryCodesLeft: enabled ? await remainingTwoFactorRecoveryCodes(id) : 0 } },
        { headers: { 'Cache-Control': 'private, no-store' } },
      )
    }
    catch (error) {
      return actionFailure(error)
    }
  },
})
