import type { WorkspaceKeychain } from '../../app/Desktop/keychain'

export function testKeychain(): WorkspaceKeychain {
  const entries = new Map<string, string>()
  return {
    async get({ name }) { return entries.get(name) ?? null },
    async set({ name, value }) { entries.set(name, value) },
    async delete({ name }) { return entries.delete(name) },
  }
}
