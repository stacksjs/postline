import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { register } from '@stacksjs/auth'
import { db } from '@stacksjs/database'
import { response } from '@stacksjs/router'

const database = db as any

/**
 * Postline is a single-user workspace: the register endpoint only works
 * while no account exists, so a deployed instance can't be signed up on
 * by strangers.
 */
export default new Action({
  name: 'Postline Register First User',
  description: 'Create the workspace account — only available on first run.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const existing = await database
      .selectFrom('users')
      .select(['id'])
      .executeTakeFirst()

    if (existing) {
      return response.json({
        ok: false,
        error: 'This workspace already has an account. Sign in instead.',
      }, { status: 403 })
    }

    const email = String(request.get('email') || '').trim()
    const password = String(request.get('password') || '')
    const name = String(request.get('name') || '').trim()

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return response.json({ ok: false, error: 'Email must be a valid email address.' }, { status: 422 })
    if (password.length < 6 || password.length > 255)
      return response.json({ ok: false, error: 'Password must be between 6 and 255 characters.' }, { status: 422 })
    if (name.length < 2 || name.length > 255)
      return response.json({ ok: false, error: 'Name must be between 2 and 255 characters.' }, { status: 422 })

    try {
      const result = await register({ email, password, name })
      if (!result)
        throw new Error('Registration failed.')

      return response.json({
        ok: true,
        data: {
          access_token: (result as any).token,
          token_type: 'Bearer',
        },
      })
    }
    catch (error) {
      return response.json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, { status: 422 })
    }
  },
})
