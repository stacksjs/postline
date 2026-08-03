import type { CrosswindOptions } from '@cwcss/crosswind'
import { defaultConfig } from '@cwcss/crosswind'

/**
 * Crosswind config — the single source of truth for Postline's design tokens
 * and for every rule a utility class cannot express.
 *
 * WHY EVERYTHING LIVES HERE
 *
 * `.stx` files must not contain a `<style>` block. Three mechanisms punish it:
 *
 *  1. It is invisible to the Crosswind extractor, which only reads `class=`
 *     attributes — so the CSS can never be deduped, purged or minified.
 *  2. The SPA router destroys every `<head>` style that is not
 *     `[data-crosswind]` on navigation, but the ENTRY page's server-rendered
 *     block carries no `data-stx-page` and is never removed. Two pages that
 *     each shipped a `:root` block therefore ended up with both live at once,
 *     fighting. Postline had exactly that: the app layout declared
 *     `--bg: #f3f3f1` and the marketing layout `--bg: #f4f4f2`.
 *  3. Tokens declared per-file drift. There were four blocks across four files.
 *
 * `preflights` CSS is prepended to the generated sheet, so it lands inside the
 * one `<style data-crosswind="generated">` tag the router treats as durable.
 *
 * ORDERING NOTE: because preflights come BEFORE the generated utilities, a
 * preflight rule that merely TIES a utility on specificity now loses to it —
 * whereas a page `<style>` block used to win by coming later. Every rule below
 * was checked against that: the `.dark .*` layer survives on specificity
 * (0,2,0 vs 0,1,0), and the data-attribute rules have no competing colour
 * utility on the same element. The marketing layout's hand-written `.font-mono`
 * was dropped rather than moved — crosswind's own defaults are already Geist /
 * Geist Mono, so it never did anything.
 *
 * AUTHORING NOTE: keep CSS comments OUTSIDE a rule block. A comment inside one
 * is parsed as part of the declaration that follows it and both are silently
 * dropped from the generated sheet.
 *
 * `theme.extend.colors` MERGES on top of the defaults, so the built-in palette
 * (zinc/neutral/emerald/…) stays available. The live dev server reads
 * `theme.extend.colors` only — a top-level `theme.colors` is silently ignored.
 */

/** App surfaces, light. The default for every page that is not the landing. */
const APP_LIGHT = `
  color-scheme: light;
  background: #f3f3f1;
  --bg: #f3f3f1;
  --panel: #ffffff;
  --panel-2: #fafafa;
  --panel-3: #f4f4f5;
  --line: #e4e4e7;
  --ink: #0a0a0a;
  --body: #3f3f46;
  --muted: #71717a;
  --accent: #0a0a0a;
  --on-accent: #ffffff;
`

/** App surfaces, dark. */
const APP_DARK = `
  color-scheme: dark;
  background: #0a0a0c;
  --bg: #0a0a0c;
  --panel: #18181b;
  --panel-2: #1c1c1f;
  --panel-3: #26262a;
  --line: #2a2a2e;
  --ink: #f4f4f5;
  --body: #d4d4d8;
  --muted: #a1a1aa;
  --accent: #f4f4f5;
  --on-accent: #0a0a0c;
`

/**
 * Marketing surfaces. The landing page is deliberately LIGHT-locked and carries
 * its own accent (emerald) and slightly warmer surfaces, so these are a scoped
 * override rather than a second competing `:root`. The marketing layout opts in
 * with `class="marketing"` on the root element.
 */
const MARKETING = `
  color-scheme: light;
  --bg: #f4f4f2;
  --panel: #ffffff;
  --panel-2: #ececeb;
  --panel-3: #e6e6e4;
  --line: #e4e4e7;
  --ink: #0a0a0a;
  --body: #3f3f46;
  --muted: #71717a;
  --accent: #2563eb;
  --on-accent: #ffffff;
`

const TOKENS = `
:root { ${APP_LIGHT} }
html.dark { ${APP_DARK} }
html.marketing { ${MARKETING} }
html.dark body { color: var(--ink); }
`

/**
 * Dark-mode override layer for RAW colour utilities.
 *
 * DEBT, tracked in docs/stx-standards-audit.md: none of this should exist. It
 * shadows generated utilities by hand because the markup still uses raw palette
 * classes (`bg-blue-50`, `text-red-700`) instead of semantic status tokens. The
 * fix is to add success/warning/danger/info surface, border and text tokens
 * above and rewrite the markup to use them — a change across queue, index,
 * accounts and analytics, deferred so this pass stays reviewable.
 *
 * These survive on specificity (`.dark .bg-blue-50` is 0,2,0 against the
 * utility's 0,1,0), not on source order, so moving them here is safe.
 */
const DARK_OVERRIDES = `
.dark .bg-blue-50 { background-color: #172554; }
.dark .bg-emerald-50 { background-color: #052e2b; }
.dark .bg-amber-50 { background-color: #3a2a08; }
.dark .bg-red-50 { background-color: #3a1414; }

.dark .bg-zinc-50\\/80, .dark .bg-zinc-50\\/48 { background-color: #1c1c1f; }
.dark .bg-zinc-50\\/40 { background-color: rgba(255, 255, 255, 0.02); }

.dark .border-zinc-200\\/80 { border-color: #2a2a2e; }
.dark .border-blue-200 { border-color: #1e3a8a; }
.dark .border-emerald-200 { border-color: #0f766e; }
.dark .border-amber-200 { border-color: #78500a; }
.dark .border-red-200 { border-color: #7f1d1d; }

.dark .text-blue-700, .dark .text-blue-800 { color: #93c5fd; }
.dark .text-emerald-700, .dark .text-emerald-800 { color: #6ee7b7; }
.dark .text-amber-800, .dark .text-amber-700 { color: #fcd34d; }
.dark .text-red-700 { color: #fca5a5; }

.dark .hover\\:bg-white:hover { background-color: #26262a; }
.dark .hover\\:bg-zinc-50:hover { background-color: #26262a; }
.dark .hover\\:bg-zinc-100:hover { background-color: #2f2f34; }
.dark .hover\\:text-zinc-900:hover { color: #f4f4f5; }
.dark .hover\\:bg-neutral-800:hover { background-color: #d4d4d8; }

.dark .border-zinc-200\\/70 { border-color: rgb(63 63 70 / 0.7); }

.dark input, .dark textarea, .dark select { color: #f4f4f5; }
.dark input::placeholder, .dark textarea::placeholder { color: #71717a; }
.dark code { background-color: #26262a; color: #e4e4e7; }

.dark [data-postline-content-shell],
.dark [data-postline-workspace],
.dark [data-postline-sidebar] { background-color: #0a0a0c; }
.dark [data-postline-workspace] {
  border-color: #2a2a2e;
  box-shadow: -10px 0 36px rgba(0, 0, 0, 0.4);
}
.dark [data-postline-sidebar] { background-color: rgba(24, 24, 27, 0.5); }
.dark [data-postline-sidebar] > .absolute { opacity: 0.35; }

.dark .bg-\\[\\#e8e8e6\\]\\/90 { background-color: rgba(63, 63, 70, 0.6); }
.dark .bg-white\\/95 { background-color: rgba(39, 39, 42, 0.95); }
.dark .bg-white\\/72 { background-color: rgba(63, 63, 70, 0.72); }
.dark .bg-white\\/60 { background-color: rgba(63, 63, 70, 0.6); }
.dark .hover\\:bg-white\\/38:hover,
.dark .hover\\:bg-white\\/60:hover,
.dark .hover\\:bg-white\\/35:hover { background-color: rgba(63, 63, 70, 0.55); }
.dark .bg-white\\/48 { background-color: rgba(39, 39, 42, 0.48); }

/* Analytics chart — CSS fill/stroke beat SVG presentation attributes, so the
   chart is not a light island on a dark page. */
.dark [data-analytics-chart] rect[rx="16"] { fill: #101014; }
.dark [data-analytics-chart] line[stroke="#e4e4e7"] { stroke: #2a2a2e; }
.dark [data-analytics-chart] text[fill="#18181b"] { fill: #e4e4e7; }
.dark [data-analytics-chart] rect[fill="#fff"] { fill: #26262a; stroke: #3f3f46; }
.dark [data-analytics-chart] .bg-zinc-100 { background-color: #26262a; }
`

/** App shell: sidebar collapse animation, native-window chrome, focus rings. */
const APP_SHELL = `
@property --postline-sidebar-width {
  syntax: '<length>';
  inherits: true;
  initial-value: 286px;
}

[data-postline-shell] {
  transition-property: --postline-sidebar-width;
  transition-duration: 220ms;
  transition-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
}

html.has-native-sidebar,
html.has-native-sidebar body {
  background: transparent !important;
}

html.has-native-sidebar [data-postline-sidebar] {
  background-color: rgba(246, 246, 244, 0.18) !important;
  -webkit-backdrop-filter: blur(24px) saturate(1.08);
  backdrop-filter: blur(24px) saturate(1.08);
}

html.postline-sidebar-collapsed [data-postline-content-shell],
html.has-native-sidebar [data-postline-content-shell],
html.has-native-sidebar [data-postline-workspace] {
  background: #f3f3f1 !important;
}

html.postline-sidebar-collapsed [data-postline-workspace] {
  border-top-left-radius: 0 !important;
  border-left-color: transparent !important;
  box-shadow: none !important;
}

html.postline-sidebar-collapsed [data-postline-sidebar] {
  overflow: visible;
  pointer-events: none;
}

html.postline-sidebar-collapsed [data-shell-controls-row] {
  display: none !important;
}

[data-sidebar-expand-fab] {
  opacity: 0;
  transform: translate3d(-6px, 0, 0) scale(0.94);
  pointer-events: none;
  transition:
    opacity 220ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

html.postline-sidebar-collapsed:not(.has-native-sidebar) [data-sidebar-expand-fab] {
  opacity: 1;
  transform: translate3d(0, 0, 0) scale(1);
  pointer-events: auto;
}

@media (max-width: 1023px) {
  [data-sidebar-expand-fab] { display: none; }

  [data-postline-mobile-nav] {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  [data-postline-mobile-nav]::-webkit-scrollbar { display: none; }
}

[data-postline-app] :is(a, button, [role='button']):focus-visible {
  outline: 2px solid rgb(82 82 91 / 0.6);
  outline-offset: 2px;
}
`

/**
 * Queue status colours, keyed off data attributes.
 *
 * Bound with `:data-status` rather than `:class` on purpose: the extractor only
 * pulls single-quoted literals out of a `:class` value, so a computed class
 * string generates no utilities at all and would need a hand-maintained
 * safelist. A data attribute sidesteps that entirely.
 *
 * Verified free of specificity ties: none of these elements carries a competing
 * colour utility in its `class` attribute.
 */
const QUEUE_STATUS = `
[data-view-toggle] { color: var(--muted); }
[data-view-toggle][data-active] { background: var(--panel); color: var(--ink); box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05); }

[data-status-pill] { color: var(--muted); background: var(--panel-3); border-color: var(--line); }
[data-status-pill][data-status="published"] { color: rgb(4 120 87); background: rgb(236 253 245); border-color: rgb(167 243 208); }
[data-status-pill][data-status="scheduled"] { color: rgb(29 78 216); background: rgb(239 246 255); border-color: rgb(191 219 254); }
[data-status-pill][data-status="publishing"] { color: rgb(146 64 14); background: rgb(255 251 235); border-color: rgb(253 230 138); }
[data-status-pill][data-status="failed"] { color: rgb(185 28 28); background: rgb(254 242 242); border-color: rgb(254 202 202); }
html.dark [data-status-pill][data-status="published"] { color: rgb(110 231 183); background: rgb(6 78 59 / 0.3); border-color: rgb(6 78 59); }
html.dark [data-status-pill][data-status="scheduled"] { color: rgb(147 197 253); background: rgb(30 58 138 / 0.3); border-color: rgb(30 58 138); }
html.dark [data-status-pill][data-status="publishing"] { color: rgb(252 211 77); background: rgb(120 53 15 / 0.3); border-color: rgb(120 53 15); }
html.dark [data-status-pill][data-status="failed"] { color: rgb(252 165 165); background: rgb(127 29 29 / 0.3); border-color: rgb(127 29 29); }

[data-cal-dot] { background: rgb(161 161 170); }
[data-cal-dot][data-status="published"] { background: rgb(16 185 129); }
[data-cal-dot][data-status="failed"] { background: rgb(239 68 68); }
[data-cal-dot][data-status="scheduled"] { background: rgb(59 130 246); }

[data-cal-cell] { background: var(--panel); }
[data-cal-cell][data-blank] { background: var(--panel-2); }
[data-cal-cell][data-today] { background: rgb(239 246 255 / 0.6); }
html.dark [data-cal-cell][data-today] { background: rgb(30 58 138 / 0.2); }
[data-cal-day] { color: var(--muted); }
[data-cal-cell][data-today] [data-cal-day] { color: rgb(29 78 216); }
html.dark [data-cal-cell][data-today] [data-cal-day] { color: rgb(147 197 253); }
`

/**
 * Settings theme picker and Bluesky connection pill. Same data-attribute
 * approach and same verified absence of competing colour utilities as
 * QUEUE_STATUS above.
 */
const SETTINGS_STATUS = `
[data-theme-option] { color: var(--muted); }
[data-theme-option][data-active] {
  background: var(--panel);
  color: var(--ink);
  box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
}
[data-bluesky-pill] { border-color: var(--line); color: var(--muted); }
[data-bluesky-pill][data-state="ready"] {
  border-color: rgb(167 243 208); background: rgb(236 253 245); color: rgb(4 120 87);
}
[data-bluesky-pill][data-state="setup"] {
  border-color: rgb(253 230 138); background: rgb(255 251 235); color: rgb(146 64 14);
}
html.dark [data-bluesky-pill][data-state="ready"] {
  border-color: rgb(6 78 59); background: rgb(6 78 59 / 0.3); color: rgb(110 231 183);
}
html.dark [data-bluesky-pill][data-state="setup"] {
  border-color: rgb(120 53 15); background: rgb(120 53 15 / 0.3); color: rgb(252 211 77);
}
`

/**
 * Marketing base rules and scroll-driven reveals.
 *
 * Scoped under `html.marketing` so the landing page's typography and smooth
 * scrolling never leak into the app shell. Animation is CSS scroll-driven —
 * Stacks ships no animation library, and the `opacity: 0` base is gated behind
 * `@supports` so browsers without `animation-timeline` (and reduced-motion
 * users) always render content visible.
 */
const MARKETING_BASE = `
html.marketing {
  font-family: Geist, ui-sans-serif, system-ui, sans-serif;
  scroll-behavior: smooth;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}

html.marketing .font-mono { font-family: Geist Mono, ui-monospace, monospace; }

html.marketing body { background-color: var(--bg); color: var(--ink); }

html.marketing ::selection { background: var(--accent); color: var(--on-accent); }

html.marketing :where(a, button):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
  border-radius: 4px;
}

@keyframes reveal-up {
  from { opacity: 0; transform: translateY(24px); }
  to   { opacity: 1; transform: translateY(0); }
}
@supports (animation-timeline: view()) {
  @media (prefers-reduced-motion: no-preference) {
    html.marketing .reveal {
      opacity: 0;
      animation: reveal-up linear both;
      animation-timeline: view();
      animation-range: entry 0% cover 28%;
    }
  }
}

/* Providers marquee — track holds two identical halves; -50% loops seamlessly. */
@keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
html.marketing .marquee-track { animation: marquee 32s linear infinite; }

@media (prefers-reduced-motion: reduce) {
  html.marketing { scroll-behavior: auto; }
  html.marketing .marquee-track { animation: none; }
}
`

export default {
  content: [
    './resources/views/**/*.stx',
    './resources/layouts/**/*.stx',
    './resources/components/**/*.stx',
    './resources/partials/**/*.stx',
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

  preflights: [
    // The base reset MUST be re-spread here. stx builds the generator config as
    // `{ ...baseConfig, ...userConfig }` (dev-server/crosswind.js:305) and gives
    // `preflights` none of the special merge handling it gives `theme` and
    // `safelist` — so declaring this key at all replaces crosswind's built-in
    // Tailwind reset outright. Omitting this line silently drops
    // `box-sizing: border-box`, the margin reset and the form normalisation
    // from every page.
    ...(defaultConfig.preflights ?? []),
    { getCSS: () => TOKENS },
    { getCSS: () => DARK_OVERRIDES },
    { getCSS: () => APP_SHELL },
    { getCSS: () => QUEUE_STATUS },
    { getCSS: () => SETTINGS_STATUS },
    { getCSS: () => MARKETING_BASE },
  ],
} satisfies CrosswindOptions
