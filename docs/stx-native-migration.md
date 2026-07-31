# STX-Native Migration: Process & Standards

> Standard + adherence audit. Runtime claims re-verified against the shipped
> `signals.js` on 2026-07-30. **Current adherence: 0%.**

## The rule

No vanilla DOM in `.stx` templates. No `document.getElementById`,
`addEventListener`, `innerHTML`, `appendChild`, or manual `setAttribute` for
rendering. State lives in signals; the DOM is a projection of that state via
directives.

## What replaces what

| Vanilla pattern | STX-native replacement |
|---|---|
| `getElementById('x').addEventListener('click', fn)` | `@click="fn"` on the element |
| `el.setAttribute('data-t', v)` | `:data-t="sig()"` (binds, and removes the attr on `false`/`null`) |
| `el.textContent = v` | `{{ sig() }}` or `:text="sig()"` |
| `el.style.display = ...` | `:show="sig()"` |
| `el.innerHTML = list.map(...)` | `@for` / `:for` over a signal |
| manual "paint on load" call | the binding's effect runs on hydration automatically |

State goes in a `<script client>` block: `const x = state(initial)`, read as
`x()`, written as `x.set(v)`. Functions declared there are in scope for
directives.

## What legitimately stays as plain script

This is the part most migrations get wrong by being too dogmatic. Three
categories are **not** DOM rendering and should stay:

1. **Pre-paint work** — e.g. applying a saved theme. It must run before first
   paint; a hydrated directive is too late and you get a flash.
2. **Things no component owns** — the root `html` element, `localStorage`,
   `document.cookie`. A signal mirroring `data-theme` is a *mirror*, not the
   source of truth, and the comment should say so.
3. **Navigation/side effects** — auth guards, logout. These clear storage and
   call `location.assign`; they render nothing.

The win is deleting *wiring* (`getElementById` + `addEventListener` + manual
repaint), not laundering every side effect through a signal.

## Process (order matters)

1. **Verify the mechanism on ONE control before bulk-converting.** Convert a
   single element, confirm it works in a real browser, then do the rest.
2. **Check what's actually supported, in the shipped runtime** — not the docs.
3. **Smallest file first**, so the pattern is established before the risky one.
   Anything owning destructive operations goes last.
4. **Measure before and after with the same harness**, diffed against a baseline
   captured minutes earlier — not a stored golden file.
5. **Run the control.** A check that reports "correct" both with and without the
   change under test is measuring nothing.

## STX-specific landmines (all fail silently)

- A literal `<html>` anywhere in a page fragment — **including inside an HTML
  comment** — turns every SPA navigation into a full reload. The router
  text-matches to detect full documents. Write "the root html element".
- `defineStore`'s `persist` is a **no-op** in the options-API form; only the
  setup-function form persists.
- A `<script>` inside an `@include` partial is rewritten into a scoped client
  script, so it can't do pre-paint work — and the include renders to **nothing**
  in the SSG build path while working fine on the dev server.
- A newly created partial isn't picked up until it's modified while the dev
  server runs. Re-verify after every edit.
- `:class` emits a stray `console.log('[stx] HIT x-class handler:')` — noisy, so
  prefer other bindings where practical.
- Structural greps miss all of the above. Verify in a browser.

## SPA container rules

- A fragment must not contain its own `<main>` — the layout provides the one the
  router swaps.
- Anything mounted at runtime must go **inside** `<main>`, never
  `document.body`, or it outlives the swap and paints stale chrome over the next
  page.
- Every page in a layout group must agree on `<main>`'s attributes; a class on
  `<main>` leaks into the next page.

---

## Runtime verification (2026-07-30)

Per step 2, checked against the shipped runtime rather than docs. The framework
is now npm-backed, so the file is `node_modules/@stacksjs/stx/dist/signals.js`,
not a vendored path.

Every claim in the standard holds:

| Claim | Result |
|---|---|
| `x-attr` is canonical, `:` kept for back-compat | Confirmed — `startsWith(':')` handling present |
| `x-class` logs `[stx] HIT x-class handler:` | Confirmed — 1 occurrence |
| `@click` event binding supported | Confirmed |
| `:text` / `x-text` supported | Confirmed |

Full directive table in the shipped runtime:

```
x-attr  x-bind   x-class  x-cloak  x-content  x-data   x-else   x-else-if
x-for   x-href   x-html   x-hydrate x-if      x-if-chain x-island x-link
x-memo  x-model  x-props  x-ref    x-scope   x-scoped  x-show   x-src
x-style x-age    x-auto   x-color-mode  x-dialog-*  x-drawer*  x-modal*
x-router-container  x-store-*  x-integrity  x-shadow  x-shrink  x-start
```

### Verified mechanism (use this, not the `stacks-stx` skill)

**The `stacks-stx` skill is stale and will send you the wrong way.** It documents
`ref()` / `computed()` imported from `@stacksjs/composables`. The shipped runtime
exports neither. The real API, from `signals-api.d.ts`:

```
state  derived  effect  batch  onMount  onDestroy
isSignal  isDerived  untrack  peek  useOptimistic
```

`state` and `onMount` are attached to `window` by `generateSignalsRuntime`, which
every build path injects, so they are **ambient in a `<script client>` block** —
no import needed.

`x-for` grammar, from `bindFor`:

```
item in list        item, index in list        (item, index) in list
```

`in` and `of` both parse; `@for`, `:for` and `x-for` are all accepted.

### The composable layer (`window.stx`) — the part that is easy to miss

Reading only the directive table leads you to hand-write things stx already
ships. The runtime attaches all of these to `window.stx`, and they are ambient
in a `<script client>` block:

| Need | Use this, not vanilla |
|---|---|
| Element access (`.focus()`, `.click()`) | `useRef('name')` → `.current`, paired with `x-ref="name"` |
| Focus state | `useFocus(target)` |
| Cookies | `useCookie(name, opts)` — returns a **signal**; `.set('')` clears it and adds `Secure` on https |
| localStorage | `useLocalStorage(key, default)` — signal-backed, JSON, syncs across tabs |
| Event subscription | `useEventListener(event, fn, { target, capture, passive, once })` — auto-unsubscribes on destroy |
| Dark mode | `useColorMode` / `useDark` — **but see the two blockers below** |
| Navigation | `navigate(url)`, `goBack()`, `goForward()` |
| Data fetching | `useFetch`, `useAsync`, `useQuery`, `useMutation` |
| Timers | `useTimeout`, `useInterval`, `useDebounce`, `useThrottle` |
| Outside-click | `useClickOutside` |
| Misc state | `useToggle`, `useCounter`, `useOptimistic` |
| Head/SEO | `useHead`, `useSeoMeta` |

Vue-compat aliases also exist (`ref`, `reactive`, `computed`, `watch`,
`watchEffect`), where `ref = state`.

**`useRef` + `x-ref` is the sanctioned imperative escape hatch.** `useRef(name)`
reads `componentScope.$refs[name]`, so `useRef('composerInput').current.focus()`
is the stx-native way to focus — the same shape as Vue's `$refs` and React's
`ref.current`. Reaching for `document.querySelector` to call `.focus()` is not
justified by "stx has no equivalent"; it does.

### Event modifiers (verified in the handler)

Parsed from `@event.mod.mod`: `prevent`, `stop`, `self`, `ctrl`, `alt`,
`shift`, `meta`, and any key name in `KEY_MAP` (e.g. `@keydown.enter`).

`once`, `passive` and `capture` are **not** applied to `addEventListener` by the
directive path — use `useEventListener`, which does accept them.

### Console noise: dev-only, not a production problem

The runtime contains 26 `console.log('[stx] …')` calls, including one on every
signal write and every event dispatch. They live in
`generateSignalsRuntimeDev()`. `generateSignalsRuntime()` pipes that through
`stripConsoleLog()` and minifies, so production is clean. Worth knowing before
filing anything: the noise seen in dev is expected. The only real exposure is
the `catch` fallback in `generateSignalsRuntime`, which returns the unstripped
dev build if `Bun.Transpiler` throws.

### Two gaps between this document and this repo

1. **The verification harness does not exist here.** The standard names
   `spa-probe.ts`, `spa-shot.ts` and `link-intercept.ts` under
   `.claude/skills/stacks-browse/scripts/`. That directory contains only
   `browse.ts`; a repo-wide find returns nothing for all three. Steps 4 and 5 of
   the process cannot be executed as written until they are added.
2. **`x-for` exists but the standard's `@for` spelling is unverified here.** The
   directive table shows `x-for`; the `@`-prefixed form was only confirmed for
   `@click`.

---

## Adherence audit

**Verdict: the codebase does not adhere, and the per-network variants work
committed in `544c453` made it worse rather than better.**

### Repo-wide baseline

| File | Lines | querySelector | addEventListener | classList |
|---|---|---|---|---|
| index.stx | 1335 | 49 | 20 | 52 |
| accounts.stx | 677 | 36 | 16 | 4 |
| layouts/postline.stx | 507 | 17 | 15 | 13 |
| queue.stx | 350 | 12 | 5 | 6 |
| timeline.stx | 209 | 5 | 1 | 0 |
| login.stx | 158 | 13 | 2 | 6 |
| settings.stx | 128 | 6 | 3 | 5 |
| analytics.stx | 89 | 0 | 0 | 0 |
| welcome.stx | 220 | 0 | 0 | 0 |
| layouts/marketing.stx | 97 | 0 | 0 | 0 |
| components/PostlineSidebar.stx | 135 | 0 | 0 | 0 |

**No view in this repo uses a signal or a directive.** A grep for
`script client`, `state(`, `@click`, `:show` and `x-attr` across
`resources/views/` returns zero files. The four files at zero are static
markup, not migrated ones.

### What commit 544c453 added

The per-network variants UI added **57 vanilla DOM operations across 350 new
lines** in `index.stx`:

| Pattern | Added |
|---|---|
| classList | 14 |
| querySelector | 11 |
| textContent | 9 |
| createElement | 8 |
| document.* | 8 |
| addEventListener | 3 |
| setAttribute | 2 |
| replaceChildren | 2 |

`variantRow()` is exactly the anti-pattern in the table above: `createElement`
plus `className` plus `textContent` plus `append`, where `x-for` over a signal
is the native form. `renderVariantPanel()` and `updateVariantMeta()` are the
"manual repaint" that a binding's effect would do automatically.

This was a deliberate call — the surrounding 1200 lines are vanilla and I
matched them rather than introducing the repo's first signal mid-feature — but
`CLAUDE.md` already stated the rule, so the honest summary is that the feature
was shipped against a documented standard.

### What the review process did and did not catch

Worth recording, because it is the same lesson as process step 5. A four-lens
adversarial review of this work found and confirmed 16 real defects. **None of
them was "this should be signals."** The lenses were scoped to correctness,
Crosswind, accessibility and regressions, so architecture conformance was
outside every one of them. A review only reports what it is pointed at.

Three of the 16 confirmed defects are ones the STX-native form makes
structurally impossible rather than merely fixed:

| Defect | Why signals would have prevented it |
|---|---|
| Staleness warning never re-evaluated while typing | A derived signal recomputes on dependency change; there is no "forgot to call the repaint function" |
| Over-limit advisory measured the shared body, not the per-provider body | One derived source feeds counter, chips and rows |
| `replaceChildren` dropped focus and undo history | `x-for` keyed reconciliation patches in place |

That is the actual argument for the migration here — not style.

---

## Migration plan

Follows the process order above. **Not started.**

### Phase 0 — make the process executable
- [ ] Add `spa-probe.ts`, `spa-shot.ts`, `link-intercept.ts` to
      `.claude/skills/stacks-browse/scripts/`, or rewrite steps 4-5 around
      `browse.ts`. Until then there is no before/after harness and no control.
- [ ] Confirm the auth-gated setup (cookie **and** localStorage token), or every
      page reports a false negative that looks like a missing link.

**Checkpoint:** a baseline can be captured and re-run.

### Phase 1 — prove the mechanism — CODE DONE, BROWSER CHECK PENDING
`settings.stx` converted in full (it was the smallest file with real behaviour,
and it happened to contain one of each "legitimately stays" category).

| Pattern | Before | After |
|---|---|---|
| querySelector | 6 | **0** |
| textContent | 3 | **0** |
| addEventListener | 3 | 1 |
| classList | 5 | 1 |
| setAttribute | 1 | 1 |

The three survivors are deliberate: two touch the root html element (category 2)
and one subscribes to an OS media query (not DOM rendering).

Directives used: `@click`, `:text`, `:data-active`, `:data-state`, plus `state`
and `onMount`. `:class` was avoided — active state binds to a data attribute and
the styling lives in a `<style>` block, which sidesteps both the `x-class`
console noise and the Crosswind safelist entirely (a bound attribute needs no
safelist entry, a bound class does).

- [x] Convert.
- [x] `pickier` clean, 105 tests pass.
- [ ] **Verify in a browser.** Theme buttons switch and persist across reload;
      the Bluesky pill turns green/amber; sign-out clears the cookie.
- [ ] **Run the control** — revert the change and confirm the check fails.
      A check that passes either way is measuring nothing.

**Checkpoint:** one directive proven end to end in this app. Nothing else is
converted until this passes, because every landmine in this document fails
silently and a wrong assumption would be replicated across ~1900 lines.

### Phase 2 — establish the pattern
- [ ] `settings.stx`, then `timeline.stx` (209 lines, 5/1/0).
- [ ] Capture before/after with the same harness.

### Phase 3 — the composer's variant panel
- [ ] Convert `variantRow` / `renderVariantPanel` / `updateVariantMeta` to a
      signal-backed `x-for`. This is the highest-value target: it is new code,
      self-contained, and its three confirmed defects were all repaint-ordering
      bugs.
- [ ] Keep `saveDraft`/`localStorage` as plain script — category 2 above.

### Phase 4 — the rest, riskiest last
- [ ] `queue.stx`, `login.stx`, `layouts/postline.stx`.
- [ ] `accounts.stx` **last**: it owns account connection and disconnection.
- [ ] The theme block in `layouts/postline.stx` stays plain script — category 1,
      pre-paint.

### Non-goals
- Converting `welcome.stx`, `analytics.stx`, `marketing.stx` or
  `PostlineSidebar.stx` — already zero vanilla DOM.
- Routing side effects and auth guards through signals — category 3.

## Filed upstream

- **[stacksjs/stx#1788](https://github.com/stacksjs/stx/issues/1788)** —
  `useColorMode` applies a class *or* an attribute but never both, and its
  persisted vocabulary is hard-coded to `light|dark|auto` so an app storing
  `'system'` gets that value silently overwritten. Both block replacing
  Postline's theme block; until fixed, the two `document.documentElement` calls
  in `settings.stx` are justified and commented as such.

No other gap found. Everything else this codebase does imperatively — focus,
programmatic click, cookies, localStorage, event subscription, navigation,
timers, fetching — has a first-class stx API.

## Open questions

1. Do the three harness scripts exist in another Stacks project to copy, or do
   they need writing? Phase 0 blocks everything and its size depends on this.
2. Is migrating `index.stx` wholesale in scope, or only the new variant panel?
   The file is 1335 lines with 121 vanilla operations; a full conversion is a
   project, not a cleanup.
3. Should this standard move into `CLAUDE.md`? It currently says only "stx
   `<script>` tags should only contain stx-compatible code", which is what got
   interpreted as "match the surrounding file".
