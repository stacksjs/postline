import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ciState } from '../../scripts/publication-check'

describe('the release gate (#234)', () => {
  test('reads the latest ReviewOS verdict, which GitHub lists first', () => {
    expect(ciState([{ context: 'ReviewOS / CI', state: 'failure' }, { context: 'ReviewOS / CI', state: 'success' }])).toBe('failure')
    expect(ciState([{ context: 'ReviewOS / CI', state: 'success' }, { context: 'ReviewOS / CI', state: 'pending' }])).toBe('success')
    expect(ciState([{ context: 'something else', state: 'success' }])).toBe('missing')
    expect(ciState([])).toBe('missing')
  })

  test('buddy release runs it before bumping', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, '../../package.json'), 'utf8'))
    expect(pkg.scripts['publication:check']).toBe('bun scripts/publication-check.ts')
  })
})
