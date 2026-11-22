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

/**
 * POSTLINE — the identity, expressed as tokens.
 *
 * Neutral surfaces, near-black ink, and a primary button that is ink in the
 * light theme and paper in the dark one. The interface is chrome around other
 * people's content (posts, avatars, link cards, charts), so the palette stays
 * out of its way: nothing here competes with a network's own colours.
 *
 * `--brand` is the one chromatic value, a signal orange. It marks what is live
 * or new (a status dot, a highlighted word, a focus ring) and is never a
 * surface or a button fill, so it keeps meaning something.
 */

/** Light theme. The default. */
const APP_LIGHT: string = `
  color-scheme: light;
  background: #fafafa;
  --bg: #fafafa;
  --panel: #ffffff;
  --panel-2: #f4f4f5;
  --panel-3: #ececef;
  --line: #e4e4e7;
  --ink: #0a0a0b;
  --body: #3f3f46;
  --muted: #71717a;
  --accent: #0a0a0b;
  --on-accent: #fafafa;
  --brand: #f0441e;
`

/** Dark theme: the same roles, inverted. */
const APP_DARK: string = `
  color-scheme: dark;
  background: #0b0b0d;
  --bg: #0b0b0d;
  --panel: #131316;
  --panel-2: #1a1a1e;
  --panel-3: #232329;
  --line: #2a2a30;
  --ink: #f4f4f5;
  --body: #d4d4d8;
  --muted: #a1a1aa;
  --accent: #f4f4f5;
  --on-accent: #0b0b0d;
  --brand: #ff6a45;
`

/**
 * The marketing site is light-locked: its product shots and illustrations are
 * drawn for a light page. It opts in with `class="marketing"` on the root
 * element and takes the light tokens whatever theme the workspace remembers.
 */
const MARKETING: string = APP_LIGHT

/**
 * Two faces, declared once at `:root`.
 *
 * - sans  Geist, for everything that is read: headings, copy, controls.
 * - mono  Geist Mono, for what is typed or counted: shell commands, shortcut
 *         keys, eyebrows and numerals that should line up.
 *
 * `--font-display`, `--font-body` and `--font-label` are the roles the markup
 * and the rules below ask for. They resolve to those two faces, so a role can
 * be given a face of its own later without touching a template.
 */
const FACES: string = `
  --font-sans: 'Geist', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono: 'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace;
  --font-display: var(--font-sans);
  --font-body: var(--font-sans);
  --font-label: var(--font-mono);
  --font-typewriter: var(--font-mono);
`

const TOKENS: string = `
:root { ${FACES} }
:root { ${APP_LIGHT} }
html.dark { ${APP_DARK} }
html.marketing { ${MARKETING} }
html.dark body { color: var(--ink); }
`

/**
 * Dark-mode override layer for RAW colour utilities.
 *
 * DEBT, tracked in stacksjs/postline#141: none of this should exist. It
 * shadows generated utilities by hand because the markup still uses raw palette
 * classes (`bg-blue-50`, `text-red-700`) instead of semantic status tokens. The
 * fix is to add success/warning/danger/info surface, border and text tokens
 * above and rewrite the markup to use them.
 *
 * WHY EVERY DECLARATION HERE IS !important
 *
 * Crosswind emits preflights inside `@layer cw-base` and the generated
 * utilities unlayered, and an unlayered rule beats a layered one before
 * specificity is consulted. So `.dark .bg-blue-50` (0,2,0, layered) lost to a
 * plain `.bg-blue-50` (0,1,0, unlayered), and this whole block did nothing:
 * the dark theme kept a light sidebar, white pills and pastel tiles.
 * `!important` is the only weight that crosses a layer boundary. It is added
 * to the block as a whole by `overriding()` below, not written per line, so a
 * rule added here cannot forget it.
 */
/** Mark every declaration in a block of CSS `!important`. */
function overriding(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/([^;{}]+:[^;{}]+?)\s*(?:!important)?\s*;/g, '$1 !important;')
}

const DARK_OVERRIDES: string = overriding(`
.dark .bg-blue-50 { background-color: #172554; }
.dark .bg-emerald-50 { background-color: #052e2b; }
.dark .bg-amber-50 { background-color: #3a2a08; }
.dark .bg-red-50 { background-color: #3a1414; }
.dark .bg-violet-50 { background-color: #251a47; }
.dark .bg-indigo-50 { background-color: #1e1b4b; }
.dark .bg-pink-50 { background-color: #3a1230; }
.dark .bg-white { background-color: var(--panel-3); }
.dark .bg-zinc-300 { background-color: #52525b; }

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
.dark .text-red-600 { color: #fca5a5; }
.dark .text-violet-700 { color: #c4b5fd; }
.dark .text-indigo-600 { color: #a5b4fc; }
.dark .text-pink-600 { color: #f9a8d4; }
.dark .text-blue-600 { color: #93c5fd; }
.dark .text-zinc-500\\/80 { color: #a1a1aa; }

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
.dark [data-postline-sidebar] { background-color: #0f0f12; }
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
`)

/** App shell: sidebar collapse animation, native-window chrome, focus rings. */
const APP_SHELL: string = `
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
    -webkit-mask-image: linear-gradient(to right, transparent, #000 14px, #000 calc(100% - 28px), transparent);
    mask-image: linear-gradient(to right, transparent, #000 14px, #000 calc(100% - 28px), transparent);
  }

  [data-postline-mobile-nav]::-webkit-scrollbar { display: none; }
}

[data-postline-app] :is(a, button, [role='button']):focus-visible {
  outline: 2px solid rgb(82 82 91 / 0.6);
  outline-offset: 2px;
}

html.dark.has-native-sidebar [data-postline-content-shell],
html.dark.has-native-sidebar [data-postline-workspace] {
  background: #0a0a0c !important;
}
`

/** Shared product UI rhythm: one radius scale, one surface language, and compact pages. */
const APP_UI: string = `
[data-postline-router] { width: 100%; }

[data-postline-page] {
  width: min(100%, 96rem);
  margin-inline: auto;
}

[data-postline-page] > header:first-child {
  min-height: 72px;
  padding: 5px 2px 7px;
}

[data-postline-page] > header:first-child h1 {
  font-family: var(--font-display);
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.15;
}

/* Section eyebrows and meta rows across the workspace. */
[data-postline-page] .kicker,
[data-postline-page] .folio,
[data-postline-page] .byline { font-family: var(--font-label); }

[data-postline-page] .rounded-2xl { border-radius: 14px; }
[data-postline-page] .rounded-xl { border-radius: 10px; }
[data-postline-page] .rounded-lg { border-radius: 8px; }

[data-postline-page] .shadow-sm {
  box-shadow: 0 1px 2px rgb(24 24 27 / 0.035), 0 8px 24px rgb(24 24 27 / 0.025);
}

[data-postline-page] :is(a, button, summary) {
  transition-duration: 150ms;
  transition-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
}

[data-postline-page] :is(button, summary):active,
[data-postline-page] a:active { transform: translateY(1px); }

[data-postline-page] :is(input, textarea, select) { border-radius: 10px; }


@media (max-width: 640px) {
  [data-postline-router] { padding: 12px; }
  [data-postline-page] { gap: 12px; }
  [data-postline-page] > header:first-child { min-height: auto; padding: 2px 1px 5px; }
  [data-postline-page] > header:first-child h1 { font-size: 21px; }
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
const QUEUE_STATUS: string = `
[data-view-toggle] { color: var(--muted); }
[data-view-toggle][data-active]:not([data-active="false"]) { background: var(--panel); color: var(--ink); box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05); }

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
[data-cal-cell][data-blank]:not([data-blank="false"]) { background: var(--panel-2); }
[data-cal-cell][data-today]:not([data-today="false"]) { background: rgb(239 246 255 / 0.6); }
html.dark [data-cal-cell][data-today]:not([data-today="false"]) { background: rgb(30 58 138 / 0.2); }
[data-cal-day] { color: var(--muted); }
[data-cal-cell][data-today]:not([data-today="false"]) [data-cal-day] { color: rgb(29 78 216); }
html.dark [data-cal-cell][data-today]:not([data-today="false"]) [data-cal-day] { color: rgb(147 197 253); }
`

/**
 * State attributes are matched as `[data-x]:not([data-x="false"])`, not bare
 * `[data-x]`. stx renders a bound `:data-x="false"` as the string "false", the
 * way it does for any data attribute, so a presence selector matched every
 * element and painted them all as selected, active or today.
 */
/**
 * Composer provider chips.
 *
 * Bound with `:data-selected` / `:data-over` / `:disabled` rather than a
 * computed `:class`, for the same reason as the queue pills: the extractor only
 * reads single-quoted literals out of a `:class` value, so a class string built
 * in the browser generates no utilities and would need a hand-maintained
 * safelist. Driving it from attributes deletes that safelist entirely.
 *
 * Checked for specificity ties against the chip's own static classes — those
 * are layout and typography only, so nothing here competes with a utility.
 */
const COMPOSER_CHIPS: string = `
[data-provider-toggle] { border-color: var(--line); background: var(--panel-2); color: var(--muted); }
[data-provider-toggle]:not([disabled]):hover { background: #ffffff; }
[data-provider-toggle][data-selected]:not([data-selected="false"]) { border-color: #0a0a0a; background: var(--accent); color: var(--on-accent); }
[data-provider-toggle][disabled] { color: #a1a1aa; cursor: not-allowed; }

[data-provider-toggle] [data-provider-dot] { background: #d4d4d8; }
[data-provider-toggle][data-selected]:not([data-selected="false"]) [data-provider-dot] { background: #34d399; }
[data-provider-toggle][data-over]:not([data-over="false"]) [data-provider-dot] { background: #ef4444; }

html.dark [data-provider-toggle]:not([disabled]):hover { background: #26262a; }
html.dark [data-provider-toggle][disabled] { color: #52525b; }
`

/**
 * The tone of the message under the automatic deletion settings. The rest of
 * the Settings window is stx's SettingsWindow and brings its own styles.
 */
const SETTINGS_STATUS: string = `
[data-retention-message] { color: var(--muted); }
[data-retention-message][data-tone="success"] { color: rgb(4 120 87); }
[data-retention-message][data-tone="error"] { color: rgb(185 28 28); }
html.dark [data-retention-message][data-tone="success"] { color: rgb(110 231 183); }
html.dark [data-retention-message][data-tone="error"] { color: rgb(252 165 165); }
`

/**
 * The marketing site.
 *
 * Scoped under `html.marketing` so none of it reaches the workspace, which
 * shares this stylesheet. Only what a utility class cannot say lives here:
 * the type ramp, the page backdrop, motion, and the few composed pieces
 * (eyebrow, grid backdrop, product frame) that would otherwise be a dozen
 * utilities repeated on thirty elements.
 */
const MARKETING_BASE: string = `
html.marketing {
  font-family: var(--font-body);
  scroll-behavior: smooth;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}

html.marketing body { background-color: var(--bg); color: var(--ink); }

html.marketing :where(h1, h2, h3, h4) {
  font-family: var(--font-display);
  font-weight: 600;
  letter-spacing: -0.03em;
  text-wrap: balance;
}

html.marketing :where(p) { text-wrap: pretty; }

html.marketing .font-mono { font-family: var(--font-mono); }

html.marketing ::selection { background: var(--ink); color: var(--bg); }

html.marketing :where(a, button, summary):focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 3px;
  border-radius: 8px;
}

/* A section eyebrow: small, mono, with the brand dot that says "this is live". */
html.marketing .eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.04em;
  color: var(--muted);
}
html.marketing .eyebrow::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: var(--brand);
}

html.marketing .text-brand { color: var(--brand); }
html.marketing .bg-brand { background-color: var(--brand); }

/*
  The hero backdrop: a hairline grid that fades out toward the fold, so the
  first screen has structure without a picture to download.
*/
html.marketing .grid-backdrop {
  background-image:
    linear-gradient(to right, rgb(10 10 11 / 0.05) 1px, transparent 1px),
    linear-gradient(to bottom, rgb(10 10 11 / 0.05) 1px, transparent 1px);
  background-size: 56px 56px;
  mask-image: radial-gradient(ellipse 80% 70% at 50% 0%, #000 35%, transparent 100%);
  -webkit-mask-image: radial-gradient(ellipse 80% 70% at 50% 0%, #000 35%, transparent 100%);
}

/* The frame around a product shot: a window, lifted off the page. */
html.marketing .product-frame {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 18px;
  box-shadow:
    0 1px 0 rgb(255 255 255 / 0.8) inset,
    0 1px 2px rgb(10 10 11 / 0.04),
    0 24px 60px -20px rgb(10 10 11 / 0.18);
}

@keyframes reveal-up {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
@supports (animation-timeline: view()) {
  @media (prefers-reduced-motion: no-preference) {
    html.marketing .reveal {
      opacity: 0;
      animation: reveal-up linear both;
      animation-timeline: view();
      animation-range: entry 0% cover 24%;
    }
  }
}

/* Networks marquee: the track holds two identical halves, so -50% loops seamlessly. */
@keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
html.marketing .marquee-track { animation: marquee 36s linear infinite; }
html.marketing .marquee-mask {
  mask-image: linear-gradient(to right, transparent, #000 12%, #000 88%, transparent);
  -webkit-mask-image: linear-gradient(to right, transparent, #000 12%, #000 88%, transparent);
}

/* The pulse on a "live" dot. */
@keyframes live-pulse {
  0% { box-shadow: 0 0 0 0 rgb(240 68 30 / 0.45); }
  100% { box-shadow: 0 0 0 8px rgb(240 68 30 / 0); }
}
html.marketing .live-dot { animation: live-pulse 1.8s ease-out infinite; }

@media (prefers-reduced-motion: reduce) {
  html.marketing { scroll-behavior: auto; }
  html.marketing .marquee-track,
  html.marketing .live-dot { animation: none; }
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
    { getCSS: (): string => TOKENS },
    { getCSS: (): string => DARK_OVERRIDES },
    { getCSS: (): string => APP_SHELL },
    { getCSS: (): string => APP_UI },
    { getCSS: (): string => QUEUE_STATUS },
    { getCSS: (): string => SETTINGS_STATUS },
    { getCSS: (): string => COMPOSER_CHIPS },
    { getCSS: (): string => MARKETING_BASE },
  ],
} satisfies CrosswindOptions
