import { log } from '@stacksjs/logging'
import { Middleware } from '@stacksjs/router'
import FrameworkAuth from '@stacksjs/defaults/app/Middleware/Auth.ts'
import { allowsNativeAppWithoutLogin } from '../Support/Auth/native'

/**
 * Authenticate the request: the framework's own middleware, plus one check.
 *
 * The Mac app runs Postline for the one person at the keyboard and has no
 * sign-in, so its agent process skips authentication. That check looks at how
 * the process was started, never at the request. Every request on a server
 * goes through the framework's middleware unchanged.
 *
 * This file used to carry a copy of the framework's logic, and the copy
 * drifted: it once read only the bearer header and the `session_id` cookie,
 * which made signing in through a browser impossible (#45). Delegating means
 * a framework fix reaches Postline on upgrade.
 *
 * Reviewed against the framework default; re-review when this fingerprint
 * stops matching (the framework warns at boot).
 * stacks-reviewed-default: 3bacd277969cbd05
 */
export default new Middleware({
  name: 'Auth',
  priority: 1,

  async handle(request) {
    if (allowsNativeAppWithoutLogin()) {
      log.debug('[middleware:auth] Desktop agent process: no sign-in')
      return
    }
    return await FrameworkAuth.handle(request)
  },
})
