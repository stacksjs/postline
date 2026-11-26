/**
 * The optional error reporter (#211): off unless an address is set, error
 * level only, and a reporter that is down is never another error.
 */
import { describe, expect, test } from 'bun:test'
import { errorReporter } from '../../app/Support/error-reporter'

const record = { level: 'error' as const, message: 'publish failed', args: [], timestamp: '2026-11-26T00:00:00.000Z', context: { requestId: 'req-1' } }

describe('error reporter', () => {
  test('nothing is sent anywhere without an address', () => {
    expect(errorReporter('')).toEqual([])
    expect(errorReporter('not-a-url')).toEqual([])
  })

  test('an error goes to the owner\'s address, at error level only', async () => {
    const sent: Array<{ url: string, body: Record<string, unknown> }> = []
    const [transport] = errorReporter('https://errors.example.com/hook', async (url, body) => { sent.push({ url, body }) })
    expect(transport?.level).toBe('error')
    transport!.log(record)
    await Bun.sleep(0)
    expect(sent).toEqual([{ url: 'https://errors.example.com/hook', body: { app: 'postline', level: 'error', message: 'publish failed', at: record.timestamp, requestId: 'req-1' } }])
  })

  test('a reporter that is down does not throw', async () => {
    const [transport] = errorReporter('https://errors.example.com/hook', async () => { throw new Error('down') })
    expect(() => transport!.log(record)).not.toThrow()
    await Bun.sleep(0)
  })
})
