import process from 'node:process'
import { validateUpdateManifest, verifyUpdateManifestSignature } from '@stacksjs/desktop-build/updater'
import desktop from '../config/desktop'

const { feedUrl, publicKeys } = desktop.webview.updates
const expectedVersion = process.argv[2]
const response = await fetch(`${feedUrl}/darwin/arm64`, { signal: AbortSignal.timeout(15_000) })

if (response.status === 404 && !expectedVersion) {
  const payload = await response.json()
  if (payload.error !== 'No update has been published for this platform.')
    throw new Error('The native desktop update route did not answer.')
  console.log('The native desktop update feed is live and has no stable release yet.')
}
else {
  if (!response.ok) throw new Error(`The desktop update feed returned HTTP ${response.status}.`)
  const manifest = validateUpdateManifest(await response.json())
  verifyUpdateManifestSignature(manifest, publicKeys)
  if (manifest.platform !== 'darwin' || manifest.architecture !== 'arm64')
    throw new Error('The desktop update feed returned an update for a different platform.')
  if (expectedVersion && manifest.version !== expectedVersion)
    throw new Error(`The desktop update feed did not publish ${expectedVersion}.`)
  console.log(`Verified the signed desktop update feed for ${manifest.version}.`)
}
