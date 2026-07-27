# Postline Landing Page — Build Plan

A public landing page for Postline (self-hosted social crossposting). Its job: convince a developer / indie-hacker to self-host it. Built with **stx + Crosswind + Iconify + composables** — no external UI or motion libraries.

> Source of the design direction: `stacks-design-taste` (read) + this doc. Implementation happens here, phase by phase.

---

## Design direction (LOCKED)

- **Aesthetic:** light-editorial, *a bit bold*. Dials ~ **VARIANCE 7 / MOTION 7 / DENSITY 3** — asymmetric, oversized statement type, generous whitespace, with **one commanding dark section** for drama.
- **Palette (one accent, locked everywhere):** warm paper `#f4f4f2` · near-black ink `#0a0a0a` · zinc hairlines `#e4e4e7` · **one emerald accent `#10b981`** (single CTA / one live indicator). No purple, no decorative gradients, no glow.
- **Type:** Geist (grotesk display) + Geist Mono (labels/code). Tight tracking, hard scale contrast, `font-display: swap`.
- **Spine:** "your posting instrument, self-hosted." Precision-tool mood.
- **Motion:** CSS + composables only — `useIntersectionObserver` scroll-reveal, CTA hover, ONE logo marquee. `prefers-reduced-motion` honored. Never framer-motion / gsap.
- **Assets:** real screenshots of Postline's own UI (composer, queue) — never fake `<div>` dashboards.
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

### ☐ Phase 0 — Foundation
- **Routing:** logged-out `/` → landing; logged-in → the app. (Recommended default; see Open Decisions.)
- **Marketing layout** `resources/views/layouts/marketing.stx`: `<head>` (SEO/OG/meta, favicon), Geist + Geist Mono, theme bootstrap, **no app chrome/sidebar**.
- **Crosswind vars:** define the landing color vars (light + the one dark section) via the tokens already registered in `config/crosswind.ts`.
- **Done when:** an empty landing route renders with the fonts + tokens and no app chrome.

### ☐ Phase 1 — Hero
- Off-grid offset composition; headline, subhead, emerald CTA, GitHub ghost link, left hairline rail.
- Composer visual: real component preview or a labeled placeholder slot.
- **Done when:** hero renders, fits the viewport, CTA visible without scroll.

### ☐ Phase 2 — Providers strip
- Six real monochrome network logos (Iconify brand collection / Simple Icons), one clean row, optional slow marquee.

### ☐ Phase 3 — The Queue (product moment)
- Queue/calendar preview panel + the three-step caption.

### ☐ Phase 4 — Own it (dark beat)
- Inverted near-black section, big statement, install-command mono detail. The line a hosted SaaS can't write.

### ☐ Phase 5 — Open + built on Stacks
- Restrained credibility block (open-source · single binary · Stacks), hairline-organized.

### ☐ Phase 6 — Close + footer
- Final CTA (same intent/label as hero) + thin footer.

### ☐ Phase 7 — Motion, responsive, a11y
- Scroll-reveal + hover + `prefers-reduced-motion`; explicit mobile collapse per section; contrast / landmarks / alt text; run the design-taste Pre-Flight checklist.

### ☐ Phase 8 — Verify + ship
- `pickier` + `typecheck` green; browser QA in **both themes** on the next `buddy dev`; commit on a branch + PR.

---

## Open decisions

1. **Routing / home:** landing at `/` (logged-out sees landing, logged-in → composer) — vs a dedicated `/welcome` route — vs a standalone marketing export. *Default taken: landing at `/`, redirect authenticated users to the app.*
2. **Real screenshots:** captured on the next `buddy dev` (server isn't up in this session — `loghq` occupies the ports). Placeholder slots until then.
3. **Copy voice:** I draft concrete, non-slop copy per phase; you refine the voice.

## Constraints / honesty

- **No browser verification in this session** (Postline's dev server isn't running here). Everything is lint + typecheck verified; you do the visual pass.
- No external UI/motion libraries. Icons via Iconify `i-*` classes. Zero em-dashes in page copy.
- Rides the Crosswind semantic tokens so the landing is theme-consistent for free.
