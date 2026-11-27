import { findToken } from '@stacksjs/auth'
import { HttpError } from '@stacksjs/error-handling'
import { Middleware, parseBearerToken } from '@stacksjs/router'
import { canCreatePost } from '../Support/Automation/tokens'

export default new Middleware({
  name: 'PostlineAutomation',
  priority: 1,

  async handle(request) {
    const credential = parseBearerToken(request.headers.get('authorization'))
    if (!credential) throw new HttpError(401, 'A Postline automation bearer token is required.')

    const token = await findToken(credential)
    if (!token) throw new HttpError(401, 'Unauthorized. Invalid or expired token.')
    if (!canCreatePost(token)) throw new HttpError(403, 'This token cannot create Postline posts.')
  },
})
