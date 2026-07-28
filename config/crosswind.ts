import type { CrosswindOptions } from '@cwcss/crosswind'

/**
 * Crosswind config — registers Postline's semantic color tokens as CSS-var-backed
 * utilities so theming (incl. dark mode) is a variable swap in one place, instead
 * of a hand-maintained `.dark .utility {}` override layer.
 *
 * The var values are defined in `:root` (light) and `.dark` (dark) in the app
 * layout (`resources/views/layouts/postline.stx`). `theme.extend.colors` MERGES
 * on top of the defaults, so the built-in palette (zinc/neutral/emerald/…) stays
 * available. NOTE: the live dev server reads `theme.extend.colors` only — a
 * top-level `theme.colors` is silently ignored.
 */
export default {
  content: [
    './resources/views/**/*.stx',
    './components/**/*.stx',
    './resources/assets/scripts/**/*.{ts,js}',
  ],

  theme: {
    extend: {
      colors: {
        // Surfaces
        'bg': 'var(--bg)', // page background
        'panel': 'var(--panel)', // card / raised surface
        'panel-2': 'var(--panel-2)', // subtle inset surface
        'panel-3': 'var(--panel-3)', // input / code surface
        // Lines
        'line': 'var(--line)', // borders / dividers
        // Text
        'ink': 'var(--ink)', // primary text + headings
        'body': 'var(--body)', // body copy
        'muted': 'var(--muted)', // secondary / meta text
        // Accent (primary buttons — inverts in dark)
        'accent': 'var(--accent)',
        'on-accent': 'var(--on-accent)',
      },
    },
  },
} satisfies CrosswindOptions
