import { describe, expect, test } from 'bun:test'
import { acquireSocialOperationLease } from '../../app/Services/Social/operation-lease'

describe('social operation leases', () => {
  test('only one owner can hold the same operation', () => {
    const key = crypto.randomUUID()
    const first = acquireSocialOperationLease(key, 1000)
    expect(first).not.toBeNull()
    expect(acquireSocialOperationLease(key, 1000)).toBeNull()
    first!.release()
    const second = acquireSocialOperationLease(key, 1000)
    expect(second).not.toBeNull()
    second!.release()
  })

  test('renewal extends ownership and an old owner cannot renew or release a replacement', () => {
    const key = crypto.randomUUID()
    let clock = 1_000_000
    const first = acquireSocialOperationLease(key, 1000, () => clock)!
    clock += 600
    expect(first.renew()).toBe(true)
    clock += 600
    expect(acquireSocialOperationLease(key, 1000, () => clock)).toBeNull()
    clock += 400
    const replacement = acquireSocialOperationLease(key, 1000, () => clock)!
    expect(replacement).not.toBeNull()
    expect(first.renew()).toBe(false)
    first.release()
    expect(replacement.renew()).toBe(true)
    expect(acquireSocialOperationLease(key, 1000, () => clock)).toBeNull()
    replacement.release()
  })
})
