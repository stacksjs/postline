import type { AccessToken } from '@stacksjs/types'
import { createToken, revokeTokenById, tokens } from '@stacksjs/auth'
import { User } from '@stacksjs/orm'
import { UserFacingError } from '../Http/user-error'

export const POST_CREATE_SCOPE = 'postline:posts:create'

export function canCreatePost(token: AccessToken): boolean {
  return (token.subjectType ?? 'users') === 'users'
    && token.scopes.includes(POST_CREATE_SCOPE)
}

export async function postTokens(userId: number) {
  return (await tokens(userId)).filter(canCreatePost)
}

export function automationOwnerId(): number {
  const owner = User.first()
  if (!owner) throw new UserFacingError('Set up the workspace before creating an automation token.')
  return Number(owner.id)
}

export async function createPostToken(userId: number, name: string, days: number) {
  const label = name.trim()
  if (!label || label.length > 100) throw new UserFacingError('Give the token a name of 1 to 100 characters.')
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new UserFacingError('A token can be valid for 1 to 90 days.')
  return createToken(userId, label, [POST_CREATE_SCOPE], {
    expiresInMinutes: days * 24 * 60,
    withRefreshToken: false,
  })
}

export async function revokePostToken(userId: number, tokenId: number): Promise<void> {
  if (!(await postTokens(userId)).some(token => token.id === tokenId))
    throw new UserFacingError('No active Postline automation token has that ID.')
  await revokeTokenById(tokenId)
}
