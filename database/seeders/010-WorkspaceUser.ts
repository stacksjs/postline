import { randomBytes } from 'node:crypto'
import process from 'node:process'
import { Seeder } from '@stacksjs/database'
import { db } from '@stacksjs/database'
import { log } from '@stacksjs/logging'
import { hashMake } from '@stacksjs/security'

/**
 * The single workspace account.
 *
 * Postline is a one-user workspace — `RegisterFirstUserAction` only
 * answers while the users table is empty, so a seeded database with no user is
 * a database nobody can sign in to, and every app route bounces to `/login`.
 * The model factory pass cannot fill this gap: it loads `app/Models/` and,
 * because that directory is not empty, never touches a framework model like
 * `User`.
 *
 * The development owner can supply a password or receive a random one.
 */
export default class WorkspaceUser extends Seeder {
  static order = 10
  static tags = ['core', 'e2e']

  async run(): Promise<void> {
    const environment = process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development'
    if (environment === 'production' || environment === 'prod') {
      log.warn('WorkspaceUser: refusing to seed an account in production.')
      return
    }

    const email = process.env.SEED_USER_EMAIL ?? 'dev@postline.test'
    const name = process.env.SEED_USER_NAME ?? 'Postline Dev'
    const requestedPassword = process.env.SEED_USER_PASSWORD

    const existing = await db
      .selectFrom('users')
      .select(['id', 'email'])
      .where('email', '=', email)
      .executeTakeFirst()

    if (existing) {
      log.info(`WorkspaceUser: ${email} already exists — leaving it alone.`)
      return
    }

    // Any user at all means the workspace is claimed. Adding a second would
    // not help: RegisterFirstUserAction is already closed, and a one-user app
    // gives the extra row nothing to do.
    const anyUser = await db.selectFrom('users').select(['id']).executeTakeFirst()
    if (anyUser) {
      log.info('WorkspaceUser: a different account already owns this workspace — skipping.')
      return
    }

    const now = new Date().toISOString()
    const password = requestedPassword || randomBytes(18).toString('base64url')

    await db
      .insertInto('users')
      .values({
        name,
        email,
        password: await hashMake(password, { algorithm: 'bcrypt' }),
        // Stamped so the seeded account skips the verification gate; a
        // developer cannot click a link in an email that was never sent.
        email_verified_at: now,
        created_at: now,
        updated_at: now,
      })
      .execute()

    log.success(`WorkspaceUser: seeded ${email}`)
    if (!requestedPassword)
      log.info(`  Generated development password: ${password}`)
  }
}
