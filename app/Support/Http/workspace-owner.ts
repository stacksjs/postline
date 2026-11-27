import { db } from '@stacksjs/database'

export async function workspaceHasOwner(): Promise<boolean> {
  return Boolean(await db.selectFrom('users').select('id').executeTakeFirst())
}
