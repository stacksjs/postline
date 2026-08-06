import type { CrosswindOptions } from '@cwcss/crosswind'
import { defaultConfig } from '@cwcss/crosswind'

/**
 * Crosswind config — the single source of truth for The Open Times' design tokens
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
 *     fighting. The Open Times had exactly that: the app layout declared
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
 * THE OPEN TIMES — an old-newspaper identity, expressed as tokens.
 *
 * The palette is a print palette, not a screen one: paper stock, ink, and one
 * spot colour. Nothing here is a neutral grey — every surface is warm, because
 * newsprint is. The greys that remain (`--muted`) are ink at partial coverage,
 * which is what a halftone actually looks like.
 *
 * `--accent` is the press red used for a masthead flash or an EXTRA banner. It
 * is deliberately the only chromatic value in the whole system: a second hue
 * would read as a website with a newspaper theme rather than as a newspaper.
 */

/** Newsprint, day edition. The default for every page that is not the front page. */
const APP_LIGHT: string = `
  color-scheme: light;
  background: #f4f0e4;
  --bg: #f4f0e4;
  --panel: #fbf8ef;
  --panel-2: #ece6d6;
  --panel-3: #e2dbc7;
  --line: #cec5ae;
  --ink: #17130f;
  --body: #3a332a;
  --muted: #7b7263;
  --accent: #9c2118;
  --on-accent: #fbf8ef;
`

/** The night edition — ink-heavy stock, paper-coloured type. */
const APP_DARK: string = `
  color-scheme: dark;
  background: #14110d;
  --bg: #14110d;
  --panel: #1d1914;
  --panel-2: #241f19;
  --panel-3: #2d2720;
  --line: #3a332a;
  --ink: #f2ece0;
  --body: #d8d0c0;
  --muted: #9b9284;
  --accent: #d9614f;
  --on-accent: #14110d;
`

/**
 * The front page. LIGHT-locked — a newspaper does not have a dark mode — and
 * on slightly older, greyer stock than the workspace, so the two surfaces read
 * as "the printed paper" and "the newsroom" rather than as one flat theme.
 * The marketing layout opts in with `class="marketing"` on the root element.
 */
const MARKETING: string = `
  color-scheme: light;
  --bg: #f1ecdd;
  --panel: #f8f4e9;
  --panel-2: #e7e0cd;
  --panel-3: #ddd4bd;
  --line: #c6bca3;
  --ink: #12100c;
  --body: #332d24;
  --muted: #756c5c;
  --accent: #9c2118;
  --on-accent: #f8f4e9;
`

/**
 * The four faces of the paper, declared once at `:root` so the workspace and
 * the front page draw from the same set.
 *
 * - masthead   blackletter, the nameplate and nothing else. It is unreadable at
 *              small sizes by design; anything under ~28px must not use it.
 * - display    a high-contrast Didone for headlines and decks.
 * - body       a book serif — this is the face that carries actual reading.
 * - label      condensed gothic for kickers, folios, bylines and UI chrome.
 * - typewriter for the two places that quote a shell command.
 *
 * Each stack ends in a real fallback rather than `sans-serif`, so a blocked
 * webfont degrades to something with the same posture instead of to Helvetica.
 */
const FACES: string = `
  --font-masthead: 'UnifrakturMaguntia', 'Playfair Display', Georgia, serif;
  --font-display: 'Playfair Display', 'Times New Roman', Georgia, serif;
  --font-body: 'Libre Baskerville', Georgia, 'Times New Roman', serif;
  --font-label: 'Oswald', 'Arial Narrow', ui-sans-serif, sans-serif;
  --font-typewriter: 'Courier New', ui-monospace, monospace;
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
const DARK_OVERRIDES: string = `
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

.dark [data-ot-content-shell],
.dark [data-ot-workspace],
.dark [data-ot-sidebar] { background-color: #0a0a0c; }
.dark [data-ot-workspace] {
  border-color: #2a2a2e;
  box-shadow: -10px 0 36px rgba(0, 0, 0, 0.4);
}
.dark [data-ot-sidebar] { background-color: rgba(24, 24, 27, 0.5); }
.dark [data-ot-sidebar] > .absolute { opacity: 0.35; }

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
const APP_SHELL: string = `
@property --ot-sidebar-width {
  syntax: '<length>';
  inherits: true;
  initial-value: 286px;
}

[data-ot-shell] {
  transition-property: --ot-sidebar-width;
  transition-duration: 220ms;
  transition-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
}

html.has-native-sidebar,
html.has-native-sidebar body {
  background: transparent !important;
}

html.has-native-sidebar [data-ot-sidebar] {
  background-color: rgba(246, 246, 244, 0.18) !important;
  -webkit-backdrop-filter: blur(24px) saturate(1.08);
  backdrop-filter: blur(24px) saturate(1.08);
}

html.ot-sidebar-collapsed [data-ot-content-shell],
html.has-native-sidebar [data-ot-content-shell],
html.has-native-sidebar [data-ot-workspace] {
  background: #f3f3f1 !important;
}

html.ot-sidebar-collapsed [data-ot-workspace] {
  border-top-left-radius: 0 !important;
  border-left-color: transparent !important;
  box-shadow: none !important;
}

html.ot-sidebar-collapsed [data-ot-sidebar] {
  overflow: visible;
  pointer-events: none;
}

html.ot-sidebar-collapsed [data-shell-controls-row] {
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

html.ot-sidebar-collapsed:not(.has-native-sidebar) [data-sidebar-expand-fab] {
  opacity: 1;
  transform: translate3d(0, 0, 0) scale(1);
  pointer-events: auto;
}

@media (max-width: 1023px) {
  [data-sidebar-expand-fab] { display: none; }

  [data-ot-mobile-nav] {
    scrollbar-width: none;
    -ms-overflow-style: none;
    -webkit-mask-image: linear-gradient(to right, transparent, #000 14px, #000 calc(100% - 28px), transparent);
    mask-image: linear-gradient(to right, transparent, #000 14px, #000 calc(100% - 28px), transparent);
  }

  [data-ot-mobile-nav]::-webkit-scrollbar { display: none; }
}

[data-ot-app] :is(a, button, [role='button']):focus-visible {
  outline: 2px solid rgb(82 82 91 / 0.6);
  outline-offset: 2px;
}

html.dark.has-native-sidebar [data-ot-content-shell],
html.dark.has-native-sidebar [data-ot-workspace] {
  background: #0a0a0c !important;
}
`

/** Shared product UI rhythm: one radius scale, one surface language, and compact pages. */
const APP_UI: string = `
[data-ot-router] { width: 100%; }

[data-ot-page] {
  width: min(100%, 96rem);
  margin-inline: auto;
}

[data-ot-page] > header:first-child {
  min-height: 72px;
  padding: 5px 2px 7px;
}

[data-ot-page] > header:first-child h1 {
  letter-spacing: -0.025em;
  line-height: 1.15;
}

[data-ot-page] .rounded-2xl { border-radius: 14px; }
[data-ot-page] .rounded-xl { border-radius: 10px; }
[data-ot-page] .rounded-lg { border-radius: 8px; }

[data-ot-page] .shadow-sm {
  box-shadow: 0 1px 2px rgb(24 24 27 / 0.035), 0 8px 24px rgb(24 24 27 / 0.025);
}

[data-ot-page] :is(a, button, summary) {
  transition-duration: 150ms;
  transition-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
}

[data-ot-page] :is(button, summary):active,
[data-ot-page] a:active { transform: translateY(1px); }

[data-ot-page] :is(input, textarea, select) { border-radius: 10px; }

.dark .bg-white { background-color: var(--panel); }
.dark .hover\:bg-white:hover { background-color: var(--panel-3); }

@media (max-width: 640px) {
  [data-ot-router] { padding: 12px; }
  [data-ot-page] { gap: 12px; }
  [data-ot-page] > header:first-child { min-height: auto; padding: 2px 1px 5px; }
  [data-ot-page] > header:first-child h1 { font-size: 21px; }
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
[data-provider-toggle][data-selected] { border-color: #0a0a0a; background: var(--accent); color: var(--on-accent); }
[data-provider-toggle][disabled] { color: #a1a1aa; cursor: not-allowed; }

[data-provider-toggle] [data-provider-dot] { background: #d4d4d8; }
[data-provider-toggle][data-selected] [data-provider-dot] { background: #34d399; }
[data-provider-toggle][data-over] [data-provider-dot] { background: #ef4444; }

html.dark [data-provider-toggle]:not([disabled]):hover { background: #26262a; }
html.dark [data-provider-toggle][disabled] { color: #52525b; }
`

/**
 * Settings theme picker and Bluesky connection pill. Same data-attribute
 * approach and same verified absence of competing colour utilities as
 * QUEUE_STATUS above.
 */
const SETTINGS_STATUS: string = `
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
 * Marketing mega-menu.
 *
 * Genuinely unreachable by a utility: descendant hover/focus-within states plus
 * a delayed `visibility` transition, which is what lets the panel fade OUT
 * rather than vanish. Scoped to html.marketing because MegaMenu.stx is used by
 * the marketing layout only.
 *
 * The comment that used to sit inside the `.menu-panel` block has been lifted
 * out: a comment inside a rule block is parsed as part of the declaration that
 * follows it, and both get dropped — which would have silently removed this
 * transition and made the panel snap.
 */
const MEGA_MENU: string = `
html.marketing .menu-item { position: static; }

html.marketing .menu-panel {
  position: absolute;
  opacity: 0;
  visibility: hidden;
  transform: translateY(-6px);
  transition:
    opacity 0.18s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.18s cubic-bezier(0.16, 1, 0.3, 1),
    visibility 0s linear 0.18s;
}

html.marketing .menu-item:hover .menu-panel,
html.marketing .menu-item:focus-within .menu-panel {
  opacity: 1;
  visibility: visible;
  transform: none;
  transition-delay: 0s;
}

html.marketing .menu-chevron {
  transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

html.marketing .menu-item:hover .menu-chevron,
html.marketing .menu-item:focus-within .menu-chevron {
  transform: rotate(180deg);
}

@media (prefers-reduced-motion: reduce) {
  html.marketing .menu-panel,
  html.marketing .menu-chevron {
    transition: none;
    transform: none;
  }
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
const MARKETING_BASE: string = `
html.marketing {
  font-family: var(--font-body);
  font-size: 17px;
  scroll-behavior: smooth;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}

/*
  Every heading on the front page is set in the display face. Done here rather
  than by adding a 'font-display' class to forty headings, and scoped to
  html.marketing so the workspace keeps its own type ramp.
*/
html.marketing :where(h1, h2, h3, h4) {
  font-family: var(--font-display);
  font-weight: 700;
  letter-spacing: -0.005em;
}

/*
  The markup labels kickers, indices and section eyebrows with 'font-mono'.
  Rather than rewrite every one of them, the class is redefined as what a
  newspaper puts in that slot: condensed gothic, small, letterspaced. The two
  places that want a genuine typewriter face ask for '.font-typewriter'.
*/
html.marketing .font-mono {
  font-family: var(--font-label);
  font-weight: 500;
  letter-spacing: 0.14em;
}

html.marketing .font-typewriter { font-family: var(--font-typewriter); letter-spacing: 0; }

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

/**
 * PRINT FURNITURE
 *
 * The pieces of a newspaper that have no equivalent in a utility framework: the
 * nameplate, the rules that separate a folio from a story, the drop cap, the
 * column gutters, and the tooth of the paper itself.
 *
 * Rounded corners are zeroed across the front page. A newspaper is made by
 * cutting and folding a flat sheet, so nothing on it has a radius — and the
 * markup is full of 'rounded-2xl' from the previous identity. The ':where()'
 * keeps the selector's own weight at zero, so the whole rule scores (0,1,1)
 * from 'html.marketing' and beats a (0,1,0) utility on specificity rather than
 * on source order (preflights are emitted BEFORE utilities, so a tie would
 * lose).
 */
const PRINT: string = `
html.marketing :where(
  .rounded, .rounded-sm, .rounded-md, .rounded-lg, .rounded-xl,
  .rounded-2xl, .rounded-3xl, .rounded-full
) { border-radius: 0; }

html.marketing :where(a, button):focus-visible { border-radius: 0; }

/*
  The tooth of the stock. Two offset dot grids at very low alpha read as
  halftone at 100% zoom and as texture when you lean in — enough to stop the
  background being a flat fill, cheap enough to be a gradient rather than an
  image request.
*/
html.marketing body {
  background-image:
    radial-gradient(circle at 1px 1px, rgb(23 19 15 / 0.045) 1px, transparent 0),
    radial-gradient(circle at 3px 4px, rgb(23 19 15 / 0.025) 1px, transparent 0);
  background-size: 6px 6px, 7px 7px;
  background-attachment: fixed;
}

/* The nameplate. Blackletter, tight, and never below 28px — see FACES. */
.masthead {
  font-family: var(--font-masthead);
  font-weight: 400;
  letter-spacing: 0.01em;
  line-height: 0.94;
}

/*
  The rules. A newspaper separates blocks with printed lines of specific
  weights, not with shadows or panels: a hairline inside a story, a thick rule
  under the nameplate, a double rule around the dateline strip.
*/
.rule-thin { border-top: 1px solid var(--line); }
.rule-thick { border-top: 3px solid var(--ink); }
.rule-double {
  border-top: 1px solid var(--ink);
  box-shadow: 0 3px 0 -1px var(--ink);
}

/*
  The folio strip: volume, date, edition. All-caps condensed at small size,
  which is exactly what it is on a real front page.
*/
.folio {
  font-family: var(--font-label);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--body);
}

/* A kicker sits above a headline and names the section. */
.kicker {
  font-family: var(--font-label);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.26em;
  text-transform: uppercase;
  color: var(--accent);
}

/* The deck is the italic sub-headline under a lede. */
.deck {
  font-family: var(--font-display);
  font-style: italic;
  font-weight: 400;
  color: var(--body);
}

/* The byline rule: a hairline above a small-caps attribution line. */
.byline {
  font-family: var(--font-label);
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--muted);
}

/*
  Drop cap on the lede.

  Deliberately the float implementation and NOT 'initial-letter'. The latter is
  the typographically correct property, but inside a multi-column container
  Chrome reserves a line box the full height of the sunk letter and then leaves
  it empty - the lede rendered with roughly 900px of blank between its first and
  second lines. The float sinks the same three lines with no such interaction.
*/
.dropcap::first-letter {
  font-family: var(--font-display);
  font-weight: 700;
  float: left;
  font-size: 3.4em;
  line-height: 0.82;
  padding: 0.06em 0.12em 0 0;
  color: var(--ink);
}

/*
  Text columns with a printed gutter rule between them, the way a broadsheet
  sets running copy. Single column below \'md\' — two 40-character columns on a
  phone would be unreadable.
*/
.columns-print { column-gap: 2.25rem; column-rule: 1px solid var(--line); }
@media (min-width: 768px) { .columns-print { column-count: 2; } }
@media (min-width: 1280px) { .columns-print-3 { column-count: 3; } }
.columns-print > :first-child { margin-top: 0; }

/*
  Ink-block button: solid, square, letterspaced caps. The hover state lifts the
  ink slightly rather than changing hue, because the palette has exactly one
  chromatic value and it is spoken for.
*/
.ink-button {
  font-family: var(--font-label);
  font-weight: 500;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  background: var(--ink);
  color: var(--bg);
  border: 1px solid var(--ink);
  transition: background-color 150ms ease, color 150ms ease;
}
.ink-button:hover { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }

.ink-button--ghost { background: transparent; color: var(--ink); }
.ink-button--ghost:hover { background: var(--ink); color: var(--bg); border-color: var(--ink); }

/*
  Links inside running copy get the underline a printed paper cannot have but a
  reader now expects.

  Restricted to links inside a paragraph or list item. A bare '.copy a' scores
  (0,2,1) and so beat '.ink-button' (0,1,0) on specificity — which painted the
  hero's primary button ink-on-ink and underlined its label. Buttons live in
  their own wrapper rather than in running text, so this bound excludes them by
  structure rather than by an :not() list that would need maintaining.
*/
html.marketing .copy :is(p, li) a { color: var(--ink); text-decoration: underline; text-underline-offset: 0.18em; text-decoration-thickness: 1px; }
html.marketing .copy :is(p, li) a:hover { color: var(--accent); }
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
    // After MARKETING_BASE: the radius reset and the copy-link rules are meant
    // to override what that block establishes, and equal-specificity rules are
    // resolved by source order.
    { getCSS: (): string => PRINT },
    { getCSS: (): string => MEGA_MENU },
  ],
} satisfies CrosswindOptions
