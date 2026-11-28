import type { WebviewAgentPreparation } from '@stacksjs/desktop-build'
import type { WorkspaceKeychain } from './keychain'
import { existsSync } from 'node:fs'
import process from 'node:process'
import { archiveRetiredPublications } from '../Support/Database/archive-retired-publications'
import { workspaceKey } from './keychain'
import { loadBundledWorkspaceLanguage } from './workspace-language'

let completeKeyMigration: (() => void) | undefined

export function finishWorkspacePreparation(): void {
  completeKeyMigration?.()
  completeKeyMigration = undefined
}

async function prepare({ dataDir, databasePath, origin }: Parameters<WebviewAgentPreparation>[0], keychain?: WorkspaceKeychain): Promise<void> {
  if (!databasePath) throw new Error('Postline requires a workspace database.')
  await loadBundledWorkspaceLanguage()
  const key = await workspaceKey(dataDir, !existsSync(databasePath), keychain)
  archiveRetiredPublications(databasePath)
  completeKeyMigration = key.complete

  // Config and app modules read these values at import time. Uploads and the
  // local blog are relative to the workspace rather than the launch directory.
  process.chdir(dataDir)
  Object.assign(process.env, {
    APP_NAME: 'Postline',
    APP_ENV: 'production',
    APP_KEY: key.value,
    APP_URL: origin,
    POSTLINE_DESKTOP_AGENT: '1',
  })
}

export default prepare
