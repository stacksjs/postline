import { describe, expect, test } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { assertSafeDeployment, deploymentProblem, isLocalOnlyAddress } from '../../app/Support/Http/deployment-guard'

const generatedKey = `base64:${randomBytes(32).toString('base64')}`

describe('isLocalOnlyAddress', () => {
  test.each(['', 'localhost', 'localhost:3000', 'postline.localhost', 'https://postline.localhost', 'app.test', '127.0.0.1', 'http://127.0.0.1:4999', 'http://[::1]:3000'])('%s is local', (url) => {
    expect(isLocalOnlyAddress(url)).toBe(true)
  })

  test.each(['postline.example.com', 'https://social.example.org', '203.0.113.9', '192.168.1.20', 'http://10.0.0.5:3000', 'localhost.example.com', 'not a url at all'])('%s is not', (url) => {
    expect(isLocalOnlyAddress(url)).toBe(false)
  })
})

describe('deploymentProblem', () => {
  test('development on a local address is fine', () => {
    expect(deploymentProblem({ APP_ENV: 'development', APP_URL: 'postline.localhost' })).toBeNull()
  })

  test('production on a public address is fine', () => {
    expect(deploymentProblem({ APP_ENV: 'production', APP_URL: 'https://postline.example.com', APP_KEY: generatedKey })).toBeNull()
  })

  test('accepts an existing full-length plain passphrase', () => {
    expect(deploymentProblem({ APP_ENV: 'production', APP_KEY: randomBytes(32).toString('hex') })).toBeNull()
  })

  test.each([undefined, '', 'base64:1234567890', ` encrypted:${generatedKey}`, `${generatedKey}!`])('production rejects an unusable key', (key) => {
    expect(deploymentProblem({ APP_ENV: 'production', APP_URL: 'https://postline.example.com', APP_KEY: key }))
      .toContain('Production needs a valid APP_KEY')
  })

  test.each(['development', 'local', 'staging', '', undefined])('APP_ENV=%s on a public address is refused', (mode) => {
    expect(deploymentProblem({ APP_ENV: mode, APP_URL: 'https://postline.example.com' })).toContain('APP_ENV=production')
  })

  test('falls back to NODE_ENV when APP_ENV is unset', () => {
    expect(deploymentProblem({ NODE_ENV: 'production', APP_URL: 'https://postline.example.com', APP_KEY: generatedKey })).toBeNull()
  })

  test('the shipped example is accepted as it is', async () => {
    const example = await Bun.file(new URL('../../.env.example', import.meta.url)).text()
    const value = (key: string): string => example.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.replace(/^"|"$/g, '') ?? ''

    expect(deploymentProblem({ APP_ENV: value('APP_ENV'), APP_URL: value('APP_URL') })).toBeNull()
  })
})

describe('assertSafeDeployment', () => {
  test('throws with what to change', () => {
    expect(() => assertSafeDeployment({ APP_ENV: 'development', APP_URL: 'https://postline.example.com' })).toThrow(/will not start/)
  })

  test('starts the desktop agent in production with its generated key', () => {
    expect(() => assertSafeDeployment({ APP_ENV: 'production', APP_URL: 'http://127.0.0.1:4999', APP_KEY: generatedKey })).not.toThrow()
  })

  test('also checks the production key behind a loopback proxy', () => {
    expect(() => assertSafeDeployment({ APP_ENV: 'production', APP_URL: 'http://127.0.0.1:4999' })).toThrow(/valid APP_KEY/)
  })
})
