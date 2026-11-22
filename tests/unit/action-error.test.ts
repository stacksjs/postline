import { describe, expect, test } from 'bun:test'
import { GENERIC_FAILURE, publicMessage } from '../../app/Support/Http/action-error'
import { UnsafeUrlError } from '../../app/Support/Http/safe-fetch'

class DatabaseError extends Error {}

describe('publicMessage', () => {
  test('passes on a message app code wrote for the owner', () => {
    expect(publicMessage(new Error('That account is not connected.'))).toBe('That account is not connected.')
  })

  test('passes on a refused address', () => {
    expect(publicMessage(new UnsafeUrlError('That address is not on the public internet.'))).toBe('That address is not on the public internet.')
  })

  test.each([
    new TypeError('undefined is not an object (evaluating \'row.id\')'),
    new RangeError('Invalid time value'),
    new DatabaseError('no such column: posts.content'),
    Object.assign(new Error('boom'), { name: 'SQLiteError' }),
  ])('withholds an error the runtime or a library produced', (error) => {
    expect(publicMessage(error)).toBe(GENERIC_FAILURE)
  })

  test.each([
    'SQLITE_CONSTRAINT: UNIQUE constraint failed: posts.uuid',
    'no such table: scheduled_jobs',
    'connect ECONNREFUSED 127.0.0.1:6379',
    'x is not a function',
    'failed\n    at handle (/srv/app/Actions/QueueSaveAction.ts:12:3)',
  ])('withholds a plain error whose message is an internal one: %s', (message) => {
    expect(publicMessage(new Error(message))).toBe(GENERIC_FAILURE)
  })

  test('withholds things that are not errors', () => {
    expect(publicMessage('a string')).toBe(GENERIC_FAILURE)
    expect(publicMessage(undefined)).toBe(GENERIC_FAILURE)
  })

  test('cuts an over-long message', () => {
    expect(publicMessage(new Error('x'.repeat(1000))).length).toBe(300)
  })

  test('uses the fallback it is given', () => {
    expect(publicMessage(new TypeError('nope'), 'Could not save the post.')).toBe('Could not save the post.')
  })
})
