import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { linkSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const WORKSPACE_KEY_SERVICE = 'org.postline.workspace'
export const WORKSPACE_KEY_ID_FILE = 'app.keychain-id'
interface WorkspaceKeyItem { service: string, name: string }
export interface WorkspaceKeychain {
  get(item: WorkspaceKeyItem): Promise<string | null>
  set(item: WorkspaceKeyItem & { value: string }): Promise<void>
  delete(item: WorkspaceKeyItem): Promise<boolean>
}

function readOptional(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8').trim()
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

function keyId(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/** Reserve the workspace ID without replacing an ID another launch has already written. */
function recordKeyId(path: string, id: string): string {
  const staged = `${path}.${randomUUID()}`
  writeFileSync(staged, `${id}\n`, { mode: 0o600, flag: 'wx' })
  try {
    linkSync(staged, path)
    return id
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    return readFileSync(path, 'utf8').trim()
  }
  finally {
    rmSync(staged, { force: true })
  }
}

export async function workspaceKey(dataDir: string, newWorkspace: boolean, keychain: WorkspaceKeychain = Bun.secrets): Promise<{ value: string, complete: () => void }> {
  const legacyPath = join(dataDir, 'app.key')
  const idPath = join(dataDir, WORKSPACE_KEY_ID_FILE)
  const legacy = readOptional(legacyPath)
  const recorded = readOptional(idPath)
  const provided = legacy && /^base64:[\dA-Za-z+/]{43}=$/.test(legacy) ? legacy : undefined
  if ((legacy !== undefined && !provided) || (recorded !== undefined && !/^[a-f0-9]{64}$/.test(recorded)))
    throw new Error('Postline found an invalid workspace key or Keychain identifier. Restore it from your backup before opening the workspace.')
  if (recorded && provided && keyId(provided) !== recorded)
    throw new Error('The app.key file does not match this workspace. Restore the original key before opening Postline.')

  const candidate = provided ?? (!recorded && newWorkspace ? `base64:${randomBytes(32).toString('base64')}` : undefined)
  const id = recorded ?? (candidate ? keyId(candidate) : undefined)
  if (!id)
    throw new Error('The workspace key is missing. Restore app.key from your backup before opening Postline.')

  const item = { service: WORKSPACE_KEY_SERVICE, name: id }
  let saved = await keychain.get(item)
  if (!saved && candidate) {
    await keychain.set({ ...item, value: candidate })
    saved = await keychain.get(item)
  }
  if (!saved || keyId(saved) !== id)
    throw new Error('Postline could not read the original workspace key from Keychain. Unlock the login keychain or restore the matching key before trying again.')

  if (!recorded) {
    const selected = recordKeyId(idPath, id)
    if (selected !== id) {
      await keychain.delete(item)
      return workspaceKey(dataDir, newWorkspace, keychain)
    }
  }

  return {
    value: saved,
    complete() {
      // An older app can still reopen a backup if the database upgrade fails.
      if (legacy !== undefined) rmSync(legacyPath, { force: true })
    },
  }
}
