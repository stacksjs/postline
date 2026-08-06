# The Open Times Landing Page — Build Plan

A public landing page for The Open Times (self-hosted social crossposting). Its job: convince a developer / indie-hacker to self-host it. Built with **stx + Crosswind + Iconify + composables** — no external UI or motion libraries.

> Source of the design direction: `stacks-design-taste` (read) + this doc. Implementation happens here, phase by phase.

---

## Design direction (LOCKED)

- **Aesthetic:** light-editorial, *a bit bold*. Dials ~ **VARIANCE 7 / MOTION 7 / DENSITY 3** — asymmetric, oversized statement type, generous whitespace, with **one commanding dark section** for drama.
- **Palette (one accent, locked everywhere):** warm paper `#f4f4f2` · near-black ink `#0a0a0a` · zinc hairlines `#e4e4e7` · **one emerald accent `#10b981`** (single CTA / one live indicator). No purple, no decorative gradients, no glow.
- **Type:** Geist (grotesk display) + Geist Mono (labels/code). Tight tracking, hard scale contrast, `font-display: swap`.
- **Spine:** "your posting instrument, self-hosted." Precision-tool mood.
- **Motion:** CSS + composables only — `useIntersectionObserver` scroll-reveal, CTA hover, ONE logo marquee. `prefers-reduced-motion` honored. Never framer-motion / gsap.
- **Assets:** real screenshots of The Open Times' own UI (composer, queue) — never fake `<div>` dashboards.
- **Copy:** short, concrete, no slop ("elevate/seamless/next-gen" banned). **Zero em-dashes** (design-taste hard rule).

## Section flow (6)

1. **Hero** — off-grid offset: headline + emerald CTA + "View on GitHub" ghost, composer screenshot bleeding off the right.
2. **Providers** — mini strip: one row / slow marquee of six monochrome network logos (Bluesky, X, LinkedIn, Instagram, Threads, Mastodon).
3. **The Queue** — inverted classic: queue/calendar panel left (⅔), "Compose · Schedule · Crosspost" caption right (⅓).
4. **Own it** — the **dark beat**: near-black section, "Your keys. Your data. Your instance." + one install-command detail.
5. **Open + built on Stacks** — light: open-source · single binary · built on Stacks (hairline-organized, not three equal cards).
6. **Close** — mini: final CTA (echoes the hero) + footer.

---

## Phases

Each phase is independently reviewable. ✅ = done, ▶ = in progress, ☐ = todo.

### ✅ Phase 0 — Foundation
- **Routing:** `/welcome` (file-based) serves the landing; app chrome lives elsewhere. (Standalone marketing route — see Open Decisions.)
- **Marketing layout** `resources/views/layouts/marketing.stx`: `<head>` (SEO/OG/meta, favicon), Geist + Geist Mono, light-locked `:root` tokens, **no app chrome/sidebar**.
- **Crosswind vars:** landing color vars back the tokens registered in `config/crosswind.ts`; the one dark section owns its own colors.

### ✅ Phase 1 — Hero
- Off-grid offset composition; headline, subhead, emerald CTA, GitHub ghost link, left hairline rail (`01`).
- Composer visual: faithful `role="img"` mini of the real product UI (six provider pills, sample post, Publish).

### ✅ Phase 2 — Providers strip
- Six monochrome Simple Icons logos (`@iconify-json/simple-icons`) in a slow CSS marquee, edge-masked, `sr-only` list for a11y, `prefers-reduced-motion` stops it.

### ✅ Phase 3 — The Queue (product moment)
- Inverted classic: faithful queue preview (three scheduled rows, one live "Publishing") left; "Compose. Schedule. Crosspost." + numbered steps right.

### ✅ Phase 4 — Own it (dark beat)
- Near-black `#0a0a0a` section, "Your keys. Your data. Your instance." + `bunx buddy deploy` mono prompt. The line a hosted SaaS can't write.

### ✅ Phase 5 — Open + built on Stacks
- Hairline-joined (`gap-px` on `bg-line`) triptych: MIT licensed · single binary · built on Stacks. Not three floating cards.

### ✅ Phase 6 — Close + footer
- Final CTA echoing the hero ("Post once. Own everything.") + thin footer.

### ▶ Phase 7 — Motion, responsive, a11y
- Done: scroll-reveal via CSS `animation-timeline: view()` (no JS), marquee, `prefers-reduced-motion` honored; per-section mobile collapse (grid `order-*` + stacking); landmarks, `role="img"` alt text, `sr-only` provider list, focus-visible.
- Pending: real-device visual pass on next `buddy dev`.

### ▶ Phase 8 — Verify + ship
- Done: `pickier` + `typecheck` green; var-backed opacity-modifier risk audited (swapped `bg-accent/10` → `bg-emerald-500/10`).
- Pending: browser QA on next `buddy dev` (light-locked, so one theme); then PR.

---

## Open decisions

1. **Routing / home:** landing at `/` (logged-out sees landing, logged-in → composer) — vs a dedicated `/welcome` route — vs a standalone marketing export. *Default taken: landing at `/`, redirect authenticated users to the app.*
2. **Real screenshots:** captured on the next `buddy dev` (server isn't up in this session — `loghq` occupies the ports). Placeholder slots until then.
3. **Copy voice:** I draft concrete, non-slop copy per phase; you refine the voice.

## Constraints / honesty

- **No browser verification in this session** (The Open Times' dev server isn't running here). Everything is lint + typecheck verified; you do the visual pass.
- No external UI/motion libraries. Icons via Iconify `i-*` classes. Zero em-dashes in page copy.
- Rides the Crosswind semantic tokens so the landing is theme-consistent for free.
