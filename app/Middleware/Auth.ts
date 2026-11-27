import { Auth } from '@stacksjs/auth/authentication'
import { authCookieName } from '@stacksjs/auth/cookie'
import { HttpError } from '@stacksjs/error-handling'
import { log } from '@stacksjs/logging'
import { Middleware, parseBearerToken } from '@stacksjs/router'
import FrameworkAuth from '@stacksjs/defaults/app/Middleware/Auth.ts'
import { allowsNativeAppWithoutLogin } from '../Support/Auth/native'

/**
 * Authenticate the request: the framework's own middleware, plus one check.
 *
 * The Mac app runs Postline for the one person at the keyboard and has no
 * sign-in, so its agent process skips authentication. That check looks at how
 * the process was started. Requests presenting a bearer, and every server
 * request, use the framework's authentication. Workspace routes require a
 * full session because automation tokens have their own narrower route.
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
    const bearer = parseBearerToken(request.headers.get('authorization'))
    if (!bearer && allowsNativeAppWithoutLogin()) {
      log.debug('[middleware:auth] Desktop agent process: no sign-in')
      return
    }
    await FrameworkAuth.handle(request)

    // The framework resolves the token from either source into the request
    // context. Legacy session IDs use the framework's session stack instead.
    const tokenCredential = bearer || request.cookie?.(authCookieName())
    if (tokenCredential && !(await Auth.currentAccessToken())?.abilities.includes('*'))
      throw new HttpError(403, 'A workspace session is required.')
  },
})
