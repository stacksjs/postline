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

  // Surface prohibited DOM access in client scripts. Left as warn-only:
  // `failOnViolation` stays false until the existing violations are cleared,
  // then flip it so regressions throw at render time.
  strict: {
    enabled: true,
    failOnViolation: false,
  },
} satisfies UiOptions
