/**
 * A fresh install sends nothing from a Stacks address (#213).
 */
import { describe, expect, test } from 'bun:test'
import emailConfig from '../../config/email'

describe('mail on a fresh install', () => {
  test('the sender is never a Stacks address, and nothing is inherited', () => {
    expect(String(emailConfig.from?.address)).not.toContain('stacksjs')
    expect(emailConfig.mailboxes).toEqual([])
    expect(emailConfig.server?.enabled).toBe(false)
  })

  test('the example environment does not set a Stacks sender', async () => {
    const example = await Bun.file(new URL('../../.env.example', import.meta.url)).text()
    expect(example).not.toMatch(/MAIL_FROM_ADDRESS=.*stacksjs/)
  })
})
