import { Auth, requestToken, sessionUser } from '@stacksjs/auth'
import { HttpError } from '@stacksjs/error-handling'
import { log } from '@stacksjs/logging'
import { Middleware } from '@stacksjs/router'
import { allowsNativeAppWithoutLogin } from '../Support/Auth/native'

/**
 * The fields the framework's own Auth middleware stamps on the request, so an
 * action can reach the caller through `request.user()` without re-resolving a
 * credential that is no longer in scope.
 */
interface StampedRequest {
  _authenticatedUser?: unknown
  _currentAccessToken?: unknown
}

/**
 * Authenticate the request.
 *
 * This exists as an app override for exactly one reason — the native-shell
 * bypass below. Everything after it should stay in step with
 * `storage/framework/defaults/app/Middleware/Auth.ts`, because drift here is
 * not a style difference: this file used to read the bearer header and the
 * `session_id` cookie and nothing else, which made signing in through a
 * browser impossible (#45). The server issued a correct session as an httpOnly
 * `auth-token` cookie, and the one place that had to honour it never looked.
 */
export default new Middleware({
  name: 'Auth',
  priority: 1,

  async handle(request) {
    if (allowsNativeAppWithoutLogin(request.headers)) {
      log.debug(`[middleware:auth] Allowing local native app request`)
      return
    }

    // `requestToken`, not `request.bearerToken()`. The framework's resolver
    // reads the Authorization header AND falls back to the httpOnly auth
    // cookie, which is the only form a browser session can take: JavaScript
    // cannot read an httpOnly cookie, so no client bridge can ever turn it
    // into a bearer header. It also accepts a lowercase `bearer` scheme, which
    // the CSRF check already treats as token-authenticated.
    const token = requestToken(request)

    if (token) {
      log.debug(`[middleware:auth] Validating token`)
      const user = await Auth.getUserFromToken(token)
      if (!user)
        throw new HttpError(401, 'Unauthorized. Invalid or expired token.')

      // Resolve the caller here or nowhere. Past this middleware the
      // request-scoped credential is gone, so an action that asks who is
      // calling gets nothing back.
      const stamped = request as typeof request & StampedRequest
      Auth.setUser(user)
      stamped._authenticatedUser = user
      stamped._currentAccessToken = await Auth.currentAccessToken()
      return
    }

    const sessionId = request.cookie('session_id')

    if (sessionId) {
      log.debug(`[middleware:auth] Validating session`)
      const user = await sessionUser(sessionId)
      if (!user)
        throw new HttpError(401, 'Unauthorized. Session expired.')

      const stamped = request as typeof request & StampedRequest
      Auth.setUser(user)
      stamped._authenticatedUser = user
      return
    }

    throw new HttpError(401, 'Unauthorized. No token or session provided.')
  },
})
