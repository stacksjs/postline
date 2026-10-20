/**
 * Ambient declarations for globals this app reads but does not define.
 *
 * Per the stx standards, shared types live as ambient declarations rather than
 * being written inline in a view and imported — a `.stx` script block must
 * never `import` a type, because auto-import detection matches on the bare
 * symbol name.
 */

/**
 * Published by the pre-paint colour-mode boot script that `app.colorMode` in
 * config/ui.ts injects at the top of `<head>`.
 *
 * These fields are the whole surface: the script stamps `<html>` once and
 * publishes what it used. There is no `sync()`, no `watching` flag and no
 * `prefers-color-scheme` listener — a caller that wants to re-apply has to
 * stamp itself, as resources/views/settings.stx does.
 *
 * Optional on `Window` because a view's client block can be parsed in the
 * window before the boot script has run.
 */
interface StxColorModeBoot {
  /** localStorage key holding the preference. `'theme'` for this app. */
  storageKey: string
  /**
   * The mode used when storage holds nothing readable. Note that a configured
   * `'system'` is normalised to `'auto'` here by the generator.
   */
  initialMode: 'light' | 'dark' | 'auto'
  /** Class toggled on `<html>` for dark. `'dark'` here. */
  darkClass: string | null
  /** Attribute set on `<html>` to the RESOLVED mode. `'data-theme'` here. */
  attribute: string | null
  /** The spelling read from and written to storage for "follow the system". */
  autoValue: 'auto' | 'system'
  /** The stored preference, normalised: a stored `system` reads back as `auto`. */
  preference: 'light' | 'dark' | 'auto'
  /** The resolved mode stamped on `<html>` at boot. */
  mode: 'light' | 'dark'
}

interface Window {
  __STX_COLOR_MODE__?: StxColorModeBoot
}
