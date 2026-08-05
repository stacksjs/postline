import { describe, expect, test } from 'bun:test'
import { parseCsv, subscriberFromCsvRow } from '../../app/Services/ImportService'

describe('csv parsing', () => {
  test('a plain export becomes rows keyed by header', () => {
    const rows = parseCsv('email,name\nreader@example.com,A Reader\nsecond@example.com,Second')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ email: 'reader@example.com', name: 'A Reader' })
  })

  test('quoted fields may contain commas', () => {
    const rows = parseCsv('email,name\nreader@example.com,"Reader, A"')
    expect(rows[0].name).toBe('Reader, A')
  })

  test('a doubled quote inside a quoted field is a literal quote', () => {
    const rows = parseCsv('email,name\nreader@example.com,"He said ""hi"""')
    expect(rows[0].name).toBe('He said "hi"')
  })

  test('quoted fields may contain newlines', () => {
    const rows = parseCsv('email,note\nreader@example.com,"line one\nline two"')
    expect(rows).toHaveLength(1)
    expect(rows[0].note).toBe('line one\nline two')
  })

  test('headers are lowercased and values trimmed, so column case does not matter', () => {
    const rows = parseCsv('Email,Name\n  reader@example.com ,  A Reader ')
    expect(rows[0]).toEqual({ email: 'reader@example.com', name: 'A Reader' })
  })

  test('windows line endings parse the same as unix ones', () => {
    const rows = parseCsv('email,name\r\nreader@example.com,A Reader')
    expect(rows[0].name).toBe('A Reader')
  })

  test('blank lines are dropped rather than becoming empty subscribers', () => {
    expect(parseCsv('email\nreader@example.com\n\n\n')).toHaveLength(1)
  })

  test('an empty file, or one with only a header, yields no rows', () => {
    expect(parseCsv('')).toEqual([])
    expect(parseCsv('   ')).toEqual([])
    expect(parseCsv('email,name')).toEqual([])
  })

  test('a short row does not read undefined into later columns', () => {
    const rows = parseCsv('email,name,plan\nreader@example.com,A Reader')
    expect(rows[0].plan).toBe('')
  })
})

describe('column aliases', () => {
  test('the common export spellings all map onto email', () => {
    expect(subscriberFromCsvRow({ email: 'a@example.com' }).email).toBe('a@example.com')
    expect(subscriberFromCsvRow({ email_address: 'b@example.com' }).email).toBe('b@example.com')
    expect(subscriberFromCsvRow({ 'email address': 'c@example.com' }).email).toBe('c@example.com')
  })

  test('name falls back through full name and first name', () => {
    expect(subscriberFromCsvRow({ full_name: 'A Reader' }).name).toBe('A Reader')
    expect(subscriberFromCsvRow({ first_name: 'A' }).name).toBe('A')
  })

  test('an unrecognised shape yields blanks rather than a guess', () => {
    const mapped = subscriberFromCsvRow({ something: 'else' })
    expect(mapped.email).toBe('')
    expect(mapped.name).toBe('')
  })
})
