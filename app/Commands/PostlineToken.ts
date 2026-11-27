import type { CLI } from '@stacksjs/types'
import process from 'node:process'
import { automationOwnerId, createPostToken, postTokens, revokePostToken } from '../Support/Automation/tokens'
import { publicMessage } from '../Support/Http/action-error'

export default function (cli: CLI) {
  cli
    .command('postline:token:create <name>', 'Create a scoped Postline post token')
    .option('--days <days>', 'Validity in days', { default: 30 })
    .action(async (name: string, options: { days: string | number }) => {
      try {
        const token = await createPostToken(automationOwnerId(), name, Number(options.days))
        console.log(token.plainTextToken)
      }
      catch (error) {
        console.error(publicMessage(error))
        process.exitCode = 1
      }
    })

  cli
    .command('postline:token:list', 'List active Postline post tokens without exposing their secrets')
    .action(async () => {
      try {
        console.log(JSON.stringify((await postTokens(automationOwnerId())).map(({ id, name, expiresAt }) => ({ id, name, expiresAt }))))
      }
      catch (error) {
        console.error(publicMessage(error))
        process.exitCode = 1
      }
    })

  cli
    .command('postline:token:revoke <id>', 'Revoke a Postline post token by ID')
    .action(async (id: string) => {
      try {
        await revokePostToken(automationOwnerId(), Number(id))
      }
      catch (error) {
        console.error(publicMessage(error))
        process.exitCode = 1
      }
    })
}
