import { Buffer } from 'node:buffer'
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { describeArtifact, UPDATE_PRIVATE_PREFIX, UPDATE_PUBLIC_PREFIX, updatePublicKey } from '@stacksjs/desktop-build/update-signing'
import { RELEASE_UPDATE_PUBLIC_KEY } from '../config/desktop'

const [operation, input] = process.argv.slice(2)
if ((operation !== 'sign' && operation !== 'verify') || !input)
  throw new Error('Usage: bun scripts/release-checksums.ts <sign|verify> <release artifact>')

const artifact = resolve(input)
const directory = dirname(artifact)
const filename = basename(artifact)
if (/[\r\n\\]/.test(filename)) throw new Error('The release artifact name cannot be used in checksums.txt.')

const checksumPath = join(directory, 'checksums.txt')
const signaturePath = join(directory, 'checksums.txt.sig')
const publicKey = createPublicKey({
  key: Buffer.from(RELEASE_UPDATE_PUBLIC_KEY.slice(UPDATE_PUBLIC_PREFIX.length), 'base64url'),
  format: 'der',
  type: 'spki',
})

const { sha256 } = await describeArtifact(artifact)
const checksum = `${sha256}  ${filename}`
if (operation === 'sign') {
  const encoded = process.env.DESKTOP_UPDATE_PRIVATE_KEY
    || await Bun.secrets.get({ service: 'postline-desktop-updates', name: 'main' })
  if (!encoded || updatePublicKey(encoded) !== RELEASE_UPDATE_PUBLIC_KEY)
    throw new Error('The release signing key does not match the published Postline verification key.')

  const privateKey = createPrivateKey({
    key: Buffer.from(encoded.slice(UPDATE_PRIVATE_PREFIX.length), 'base64url'),
    format: 'der',
    type: 'pkcs8',
  })
  const contents = Buffer.from(`${checksum}\n`)
  await Bun.write(checksumPath, contents)
  await Bun.write(signaturePath, sign(null, contents, privateKey))
}

const contents = new Uint8Array(await Bun.file(checksumPath).arrayBuffer())
const signature = new Uint8Array(await Bun.file(signaturePath).arrayBuffer())
if (!verify(null, contents, publicKey, signature)) throw new Error('Postline checksum signature verification failed.')
if (!new TextDecoder().decode(contents).split('\n').includes(checksum)) throw new Error('The release artifact does not match the signed checksum.')
console.log(`Verified the signed checksum for ${filename}.`)
