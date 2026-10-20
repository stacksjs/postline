import type { StxOptions as UiOptions } from '@stacksjs/stx'

/**
 * STX Configuration for Stacks
 * Note: Dashboard mode overrides these settings via serve() options
 *
 * `root` and `pagesDir` are pinned deliberately — do not delete them.
 *
 * When `root` is absent, `resolveStxRoot` (@stacksjs/stx/dist/config.js:363)
 * SNIFFS it from the filesystem: if both `resources/views` and
 * `resources/layouts` exist it returns `root: 'resources'`. It then re-prefixes
 * `componentsDir` / `layoutsDir` / `partialsDir` with that root (config.js:409),
 * turning the three values below into `resources/resources/*` — directories that
 * do not exist. That is what shipped every production page with
 * `[Error loading component: ENOENT ... 'ot-sidebar']` in place of the
 * sidebar, no navigation at all, and the developer's absolute home path leaked
 * into the HTML. The dev server hid it by hardcoding its own componentsDir.
 *
 * Pinning `root: '.'` makes the `loaded.root !== '.'` guard at config.js:409
 * false, so the three directories below are taken literally and the build path
 * and the serve path finally agree.
 *
 * `pagesDir` MUST accompany `root`: resolveStxRoot early-returns
 * `pagesDir: configPagesDir || 'pages'`, so setting `root` alone would silently
 * point the whole app at a non-existent `pages/` directory.
 */

export default {
  // Project root. Pinned so directory keys are never double-prefixed.
  root: '.',

  // Pages directory - every .stx below this is a public route
  pagesDir: 'resources/views',

  // Components directory - for user-defined components
  componentsDir: 'resources/components',

  // Layouts directory - for layout templates
  layoutsDir: 'resources/layouts',

  // Partials directory - for partial templates
  partialsDir: 'resources/partials',

  // Composables directory. Required once `root` is '.': the loader's default
  // probe resolves ['composables', 'functions'] against root, so it would look
  // for `./functions` and miss `resources/functions`.
  composablesDir: 'resources/functions',

  // Suppress the framework's placeholder SEO tags. Without this, injectSeoTags
  // splices `<meta name="title" content="stx Project">` and
  // `og:description = "A website built with stx templating engine"` into every
  // page, ahead of the real description.
  skipDefaultSeoTags: true,

  app: {
    /**
     * The pre-paint theme stamp, owned by the framework rather than copied into
     * every layout. `injectColorModeBootScript` places this at the very top of
     * `<head>`, above any stylesheet — CSS blocks JS, so a `<link>` above it
     * would delay the one script whose whole job is to beat first paint.
     *
     * These five values are exactly what the four hand-rolled copies did:
     * read `theme`, treat `system` as "follow the OS", then set `data-theme` to
     * the RESOLVED `dark`/`light` and toggle the `dark` class. Both axes are
     * load-bearing and that is why this could not be adopted before — every
     * `dark:` utility and the CSS-var overrides key off the class, while the
     * design tokens key off the attribute.
     *
     * Both blockers the old comments cite are closed and shipped:
     *   - stacksjs/stx#1788 — applyDOM set EITHER darkClass OR attribute, and
     *     persisted only light|dark|auto. `stamp()` now sets both, and
     *     `autoValue: 'system'` keeps this app's existing stored vocabulary, so
     *     nobody's saved preference is rewritten.
     *   - stacksjs/stx#1794 — useColorMode had no pre-paint story. This boot
     *     script IS the pre-paint story.
     *
     * Scope, so nobody expects more than it does: the generated script stamps
     * ONCE, before paint, and publishes `window.__STX_COLOR_MODE__` with the
     * resolved mode and this config. It installs no `prefers-color-scheme`
     * listener and exposes no re-apply hook, so a live OS theme change is not
     * picked up until the next load — same as the hand-rolled copies it
     * replaces, so no behaviour is lost. The runtime switcher in
     * settings.stx still stamps on click; it now reads `darkClass` and
     * `attribute` off the published config so the two cannot drift.
     *
     * `initialMode: 'system'` is normalised to `'auto'` inside the generated
     * config, while `autoValue: 'system'` controls what is read from and
     * written to storage — which is what keeps existing saved preferences
     * working.
     */
    colorMode: {
      storageKey: 'theme',
      initialMode: 'system',
      autoValue: 'system',
      darkClass: 'dark',
      attribute: 'data-theme',
    },
  },

  // Surface prohibited DOM access in client scripts. Left as warn-only.
  // `failOnViolation` MUST stay false until stacksjs/stx#2097 ships: `true`
  // does not harden this gate, it hides it. validateClientScript throws a
  // plain Error, which processDirectives catches at process.js:417 — that line
  // rethrows only StxValidationError, a class the package never constructs —
  // so the violation lands in createFallbackContent. Measured on 0.2.605: one
  // prohibited call took a marketing page from 38329 bytes to 9396, no <h1>,
  // no footer, the body replaced by an error string leaking source paths, at
  // HTTP 200, with nothing in the server log. With `false` the same violation
  // prints a warning and the page renders.
  strict: {
    enabled: true,
    failOnViolation: false,
  },
} satisfies UiOptions
