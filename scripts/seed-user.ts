#!/usr/bin/env bun
/**
 * Create the workspace account directly.
 *
 * Postline is single-user: `/api/register` only works while the `users` table
 * is empty, and every other route is auth-gated. A fresh clone therefore has a
 * chicken-and-egg problem — you cannot sign in, and the only way to create an
 * account is through the login page. This script is the way out, and the way to
 * seed an account for e2e testing without depending on the login UI working.
 *
 * It calls the same `register()` the register action uses, so the password hash
 * and token are produced exactly the way sign-in expects. Do not hand-write a
 * row into `users` instead — the hash would not match.
 *
 *   bun run scripts/seed-user.ts
 *   bun run scripts/seed-user.ts --email me@example.com --password hunter2 --name Glenn
 */
import process from 'node:process'
import { register } from '@stacksjs/auth'
import { db } from '@stacksjs/database'

const database = db as any

function arg(flag: string, fallback: string): string {
  const index = process.argv.indexOf(`--${flag}`)
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const email = arg('email', 'dev@postline.test')
const password = arg('password', 'postline-dev')
const name = arg('name', 'Postline Dev')

// Mirrors the validation in RegisterFirstUserAction, so a seeded account can
// always be re-created through the UI with the same credentials.
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error(`Invalid email: ${email}`)
  process.exit(1)
}
if (password.length < 6 || password.length > 255) {
  console.error('Password must be between 6 and 255 characters.')
  process.exit(1)
}
if (name.length < 2 || name.length > 255) {
  console.error('Name must be between 2 and 255 characters.')
  process.exit(1)
}

const existing = await database.selectFrom('users').select(['id', 'email']).executeTakeFirst()
if (existing) {
  console.log(`A user already exists (id=${existing.id}, ${existing.email}).`)
  console.log('Postline is single-user — delete that row first if you meant to replace it.')
  process.exit(0)
}

const result = await register({ email, password, name } as any)
if (!result?.token) {
  console.error('Registration returned no token.')
  process.exit(1)
}

console.log('Workspace account created.\n')
console.log(`  email     ${email}`)
console.log(`  password  ${password}`)
console.log('\nSign in at /login. To skip the login page entirely, set this cookie')
console.log('on the app origin and reload:\n')
console.log(`  document.cookie = 'auth-token=${encodeURIComponent(String(result.token))}; path=/; max-age=2592000; SameSite=Lax'`)
