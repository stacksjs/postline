import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The sign-in page's basics (#178): a font, focus where typing starts, and
// the autocomplete hints a password manager needs to save the first password.
const read = (path: string): string => readFileSync(join(import.meta.dir, '../..', path), 'utf8')
const page = read('resources/views/login.stx')

describe('the sign-in page', () => {
  it('loads its font and scripts from a head', () => {
    const layout = read('resources/layouts/default.stx')
    expect(layout.indexOf('@head')).toBeLessThan(layout.indexOf('<FontFaces />'))
    expect(layout.indexOf('<FontFaces />')).toBeLessThan(layout.indexOf('@endhead'))
  })

  it('starts in the email field and moves to the code field when one is due', () => {
    expect(page).toMatch(/name="email"[^>]*autofocus/)
    expect(page).toContain('ref="codeInput"')
    expect(page).toContain('codeInput.current?.focus()')
  })

  it('asks for a new password while the workspace account is created', () => {
    const setupPage = read('resources/views/setup.stx')
    expect(page).toContain('autocomplete="current-password"')
    expect(setupPage).toMatch(/name="password"[^>]*autocomplete="new-password"/)
    expect(setupPage).toMatch(/name="password_confirmation"[^>]*autocomplete="new-password"/)
  })

  it('announces errors and uses no inline styles', () => {
    expect(page).toMatch(/role="alert"/)
    expect(page).not.toContain('style="')
  })

  it('links the recovery instructions', () => {
    expect(page).toContain('docs/first-run.md#if-you-lose-the-password')
  })
})
