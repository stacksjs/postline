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
  --muted: #67676f;
  --accent: #0a0a0b;
  --on-accent: #fafafa;
  --brand: #f0441e;
  --raised: #ffffff;
  --nav-active: rgba(232, 232, 230, 0.9);
  --hover: #fafafa;
  --line-strong: #d4d4d8;
  --field-line: #86868f;
  --focus-ring: #2563eb;
  --accent-hover: #262626;
  --glass: rgba(255, 255, 255, 0.72);
  --glass-strong: rgba(255, 255, 255, 0.95);
  --glass-hover: rgba(255, 255, 255, 0.4);
  --focus: rgba(161, 161, 170, 0.5);
  --on-solid: #ffffff;
  --success: #047857;
  --success-soft: #ecfdf5;
  --success-line: #a7f3d0;
  --success-solid: #10b981;
  --warning: #92400e;
  --warning-soft: #fffbeb;
  --warning-line: #fde68a;
  --danger: #b91c1c;
  --danger-soft: #fef2f2;
  --danger-line: #fecaca;
  --danger-solid: #dc2626;
  --danger-solid-hover: #b91c1c;
  --info: #1d4ed8;
  --info-soft: #eff6ff;
  --info-line: #bfdbfe;
  --info-solid: #3b82f6;
  --note: #6d28d9;
  --note-soft: #f5f3ff;
  --note-line: #ede9fe;
  --net-x: #18181b;
  --net-mastodon: #4f46e5;
  --net-instagram: #db2777;
  --net-bluesky: #2563eb;
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
  --raised: #232329;
  --nav-active: rgba(63, 63, 70, 0.6);
  --hover: #26262a;
  --line-strong: #52525b;
  --field-line: #6e6e78;
  --focus-ring: #60a5fa;
  --accent-hover: #d4d4d8;
  --glass: rgba(63, 63, 70, 0.72);
  --glass-strong: rgba(39, 39, 42, 0.95);
  --glass-hover: rgba(63, 63, 70, 0.55);
  --focus: rgba(161, 161, 170, 0.55);
  --on-solid: #ffffff;
  --success: #6ee7b7;
  --success-soft: #052e2b;
  --success-line: #0f766e;
  --success-solid: #10b981;
  --warning: #fcd34d;
  --warning-soft: #3a2a08;
  --warning-line: #78500a;
  --danger: #fca5a5;
  --danger-soft: #3a1414;
  --danger-line: #7f1d1d;
  --danger-solid: #dc2626;
  --danger-solid-hover: #b91c1c;
  --info: #93c5fd;
  --info-soft: #172554;
  --info-line: #1e3a8a;
  --info-solid: #3b82f6;
  --note: #c4b5fd;
  --note-soft: #251a47;
  --note-line: #3b2a6b;
  --net-x: #3f3f46;
  --net-mastodon: #4f46e5;
  --net-instagram: #db2777;
  --net-bluesky: #2563eb;
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

// `.brand-mark` is the Postline mark drawn in CSS: a post on a line, making a
// P, on the ink tile. The percentages are `public/favicon.svg`'s shapes on its
// 64-unit grid, so the mark in the page and the one in the tab are the same
// drawing. It is CSS and not an image so the tile and stem follow the theme:
// in dark mode the tile is pale and the stem dark.
//
// `font-family` on `:root` sets every surface in the sans face. Without it the
// app shell fell back to the system font: only the marketing rules ever asked
// for Geist. It rides on the `:root` block that carries the tokens because the
// CSS engine drops a separate `html, body { … }` rule from this string, and
// `:root` outranks the reset's `html` selector. The note is here and not
// beside the rule because the engine also drops whatever follows a comment.
const TOKENS: string = `
:root { ${FACES} font-family: var(--font-sans); }
.brand-mark { position: relative; display: inline-block; flex-shrink: 0; background: var(--ink); border-radius: 23.4%; }
.brand-mark::before { content: ''; position: absolute; left: 27.3%; top: 23.4%; width: 10.9%; height: 53.2%; border-radius: 999px; background: var(--bg); }
.brand-mark::after { content: ''; position: absolute; left: 40.2%; top: 23.4%; width: 32.8%; height: 32.8%; border-radius: 50%; background: var(--brand); }
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

.dark input, .dark textarea, .dark select { color: #f4f4f5; }
.dark input::placeholder, .dark textarea::placeholder { color: #8b8b94; }
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

/* Analytics chart — CSS fill/stroke beat SVG presentation attributes, so the
  chart is not a light island on a dark page. */
.dark [data-analytics-chart] rect[rx="16"] { fill: #101014; }
.dark [data-analytics-chart] line[stroke="#e4e4e7"] { stroke: #2a2a2e; }
.dark [data-analytics-chart] text[fill="#18181b"] { fill: #e4e4e7; }
.dark [data-analytics-chart] rect[fill="#fff"] { fill: #26262a; stroke: #3f3f46; }
`)

/** App shell: sidebar collapse animation, native-window chrome, focus rings. */
/**
 * Motion (#152): three durations for everything that moves, and one guard.
 *
 * With reduced motion asked for, nothing moves but opacity: animations run a
 * single imperceptible frame (a spinner stands still), transitions keep only
 * their fade, the press-down nudge and view transitions are off, and smooth
 * scrolling jumps. It is one rule here instead of a guard in each stylesheet,
 * so a new animation is covered without anyone remembering to. !important
 * because utilities are unlayered and these preflights are not.
 */
const MOTION: string = `
:root {
  --duration-fast: 120ms;
  --duration: 150ms;
  --duration-slow: 180ms;
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
}
::view-transition-old(root), ::view-transition-new(root) { animation-duration: var(--duration-slow); animation-timing-function: var(--ease-out); }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-property: opacity !important;
    scroll-behavior: auto !important;
  }
  [class*="active:translate"]:active, [class*="active:scale"]:active { transform: none !important; translate: none !important; scale: none !important; }
  ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation: none !important; }
}
`

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

  [data-postline-shell] {
    --postline-bottom-nav-height: calc(3.75rem + env(safe-area-inset-bottom, 0px));
  }

  [data-postline-content-shell] { padding-bottom: var(--postline-bottom-nav-height); }

  [data-postline-mobile-nav] {
    height: var(--postline-bottom-nav-height);
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  [data-postline-shell] + #postline-toast-host {
    bottom: calc(1rem + 3.75rem + env(safe-area-inset-bottom, 0px));
  }

}

[data-postline-mobile-menu] {
  position: fixed;
  inset: auto 0 0;
  margin: 0;
  width: 100%;
  max-width: 100%;
  max-height: calc(100dvh - 1rem);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

[data-postline-mobile-menu]::backdrop { background: rgb(15 23 42 / 48%); }

/* A focus ring every control shows, at 3:1 against the panels (#142). The
   writing surfaces with no border of their own opt in with data-focus-outline. */
[data-postline-app] :is(a, button, [role='button'], [data-focus-outline]):focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

[data-postline-app] :is(input, textarea)::placeholder { color: var(--muted); }

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
/* Queue tabs and per-network chips (#168). */
[data-queue-tab] { color: var(--muted); }
[data-queue-tab]:hover { color: var(--ink); background: var(--panel-2); }
[data-queue-tab][data-active]:not([data-active="false"]) { color: var(--ink); background: var(--panel-3); }
[data-queue-tab] [data-queue-tab-count] { background: var(--panel-3); color: var(--muted); }
[data-queue-tab][data-tone="danger"] [data-queue-tab-count] { background: var(--danger-soft); color: var(--danger); }
[data-target-chip] { color: var(--body); border-color: var(--line); background: var(--panel-2); }
[data-target-chip] [data-target-dot] { background: var(--line-strong); }
[data-target-chip][data-state="sent"] [data-target-dot] { background: var(--success); }
[data-target-chip][data-state="failed"] { color: var(--danger); border-color: var(--danger-line); background: var(--danger-soft); }
[data-target-chip][data-state="failed"] [data-target-dot] { background: var(--danger); }

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
[data-provider-toggle][data-connect="true"] { border-style: dashed; color: var(--body); }

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

// The marketing site's own rules live in resources/assets/styles/marketing.css,
// linked from the marketing layout, so the workspace does not download them.

export default {
  content: [
    './resources/views/**/*.stx',
    './resources/layouts/**/*.stx',
    './resources/components/**/*.stx',
    './resources/partials/**/*.stx',
    './resources/functions/**/*.ts',
    './resources/assets/scripts/**/*.{ts,js}',
  ],

  theme: {
    extend: {
      // `font-sans` and `font-mono` have to mean the same faces as the tokens.
      // The shell's root element carries `font-sans`, and with the engine's
      // default that utility set the whole app in the system font whatever
      // `:root` said.
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      // The type scale is 12, 13, 14, 16, 20, 24. Five of those are the
      // engine's own names (xs, sm, base, xl, 2xl); 13 is the size of
      // interface text (rows, buttons, fields) and gets the one name added
      // here. No view uses a bracketed pixel size: tests/unit/type-scale.test.ts
      // fails if one comes back.
      //
      // Weights: 400 for reading text, 500 (`font-medium`) for labels and
      // controls, 600 (`font-semibold`) for headings and emphasis. Nothing is
      // set in 700.
      fontSize: {
        ui: ['13px', { lineHeight: '1.4' }],
      },
      // One radius and shadow scale for every surface (#143). These used to be
      // redefined under [data-postline-page] only, so `rounded-xl` was 10px
      // in a view and 12px in the sidebar, the sign-in page and a toast.
      borderRadius: {
        'lg': '8px',
        'xl': '10px',
        '2xl': '14px',
      },
      boxShadow: {
        sm: '0 1px 2px rgb(24 24 27 / 0.035), 0 8px 24px rgb(24 24 27 / 0.025)',
      },
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
        // Everything below has a light and a dark value in APP_LIGHT and
        // APP_DARK. Views use these names and never a palette colour
        // (tests/unit/colour-tokens.test.ts): a palette colour has one value,
        // so it needed an override layer to survive dark mode.
        //
        // raised/hover/glass: surfaces above the page. line-strong: a border
        // under the pointer. focus: the focus ring. on-solid: text on a solid
        // status or network colour.
        // success, warning, danger, info, note: the text colour; -soft is its
        // tinted background, -line its border, -solid a filled dot or button.
        // net-*: a network's own colour, for avatars.
        'raised': 'var(--raised)',
        'nav-active': 'var(--nav-active)',
        'hover': 'var(--hover)',
        'line-strong': 'var(--line-strong)',
        // Input borders and the focus ring, at 3:1 against the panels (#142).
        'field-line': 'var(--field-line)',
        'focus-ring': 'var(--focus-ring)',
        'accent-hover': 'var(--accent-hover)',
        'glass': 'var(--glass)',
        'glass-strong': 'var(--glass-strong)',
        'glass-hover': 'var(--glass-hover)',
        'focus': 'var(--focus)',
        'on-solid': 'var(--on-solid)',
        'success': 'var(--success)',
        'success-soft': 'var(--success-soft)',
        'success-line': 'var(--success-line)',
        'success-solid': 'var(--success-solid)',
        'warning': 'var(--warning)',
        'warning-soft': 'var(--warning-soft)',
        'warning-line': 'var(--warning-line)',
        'danger': 'var(--danger)',
        'danger-soft': 'var(--danger-soft)',
        'danger-line': 'var(--danger-line)',
        'danger-solid': 'var(--danger-solid)',
        'danger-solid-hover': 'var(--danger-solid-hover)',
        'info': 'var(--info)',
        'info-soft': 'var(--info-soft)',
        'info-line': 'var(--info-line)',
        'info-solid': 'var(--info-solid)',
        'note': 'var(--note)',
        'note-soft': 'var(--note-soft)',
        'note-line': 'var(--note-line)',
        'net-x': 'var(--net-x)',
        'net-mastodon': 'var(--net-mastodon)',
        'net-instagram': 'var(--net-instagram)',
        'net-bluesky': 'var(--net-bluesky)',
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
    { getCSS: (): string => MOTION },
    { getCSS: (): string => APP_SHELL },
    { getCSS: (): string => APP_UI },
    { getCSS: (): string => QUEUE_STATUS },
    { getCSS: (): string => SETTINGS_STATUS },
    { getCSS: (): string => COMPOSER_CHIPS },
  ],
} satisfies CrosswindOptions
