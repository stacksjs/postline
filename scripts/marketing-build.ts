/**
 * Generate the marketing feature and use-case pages from the catalog.
 *
 * stx routes from the filesystem, so each entry needs a real `.stx` file rather
 * than one dynamic route. Generating them keeps eleven pages consistent: change
 * the shape here once instead of editing eleven files by hand.
 *
 *   bun scripts/marketing-build.ts
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import type { MarketingEntry } from '../app/Support/Marketing/catalog'
import { FEATURES, USE_CASES } from '../app/Support/Marketing/catalog'

const root = join(import.meta.dir, '..')
const SITE = 'https://postline.stacksjs.com'

/** Escape for a single-quoted stx `@section` argument. */
function q(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function page(entry: MarketingEntry, kind: 'feature' | 'use-case', siblings: MarketingEntry[]): string {
  const base = kind === 'feature' ? '/features' : '/use-cases'
  const label = kind === 'feature' ? 'Features' : 'Use cases'
  const others = siblings.filter(s => s.slug !== entry.slug).slice(0, 3)

  return `@extends('layouts/marketing')

@section('title', '${q(entry.title)} - Postline')
@section('description', '${q(entry.summary)}')
@section('canonical', '${SITE}${base}/${entry.slug}')
@section('ogImage', '${SITE}/images/og/${kind}-${entry.slug}.png')

@section('content')
  <article class="mx-auto px-6 max-w-[1400px]">
    <!-- Hero. Left-aligned, asset-free: this is a detail page, so the headline
        and the single CTA carry it. -->
    <header class="grid gap-6 pb-14 pt-16 lg:pt-20 max-w-3xl">
      <nav class="flex gap-2 items-center text-[13px] text-muted" aria-label="Breadcrumb">
        <a class="hover:text-ink transition-colors" href="/">Postline</a>
        <span aria-hidden="true">/</span>
        <span class="text-body">${label}</span>
      </nav>
      <h1 class="m-0 font-semibold leading-[1.05] text-4xl text-ink tracking-tight md:text-6xl">${entry.title}</h1>
      <p class="m-0 max-w-[60ch] leading-relaxed text-body text-lg">${entry.intro}</p>
      <div class="flex flex-wrap gap-3 items-center">
        <a class="inline-flex items-center px-5 h-11 font-medium text-on-accent text-sm bg-ink hover:bg-neutral-800 rounded-xl transition-colors" href="/login" data-stx-link>Get started</a>
        <a class="inline-flex items-center px-5 h-11 font-medium text-body text-sm hover:bg-panel-2 border border-line rounded-xl transition-colors" href="https://github.com/stacksjs/postline">Read the source</a>
      </div>
    </header>

    <!-- Body. Two stacked prose blocks, not a card grid: this is reading
        material, and cards would add chrome without adding hierarchy. -->
    <section class="grid gap-10 lg:gap-16 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] py-14 border-line border-t">
      <div class="grid gap-10">
${entry.sections.map(s => `        <div class="grid gap-3 max-w-[62ch]">
          <h2 class="m-0 font-semibold text-2xl text-ink tracking-tight">${s.heading}</h2>
          <p class="m-0 leading-relaxed text-body">${s.body}</p>
        </div>`).join('\n')}
      </div>

      <aside class="lg:pt-1">
        <ul class="m-0 p-0 list-none border-line border-t divide-line divide-y">
${entry.points.map(p => `          <li class="flex gap-3 items-start py-4">
            <span class="shrink-0 mt-0.5 h-5 w-5 text-accent i-hugeicons-checkmark-circle-02" aria-hidden="true"></span>
            <span class="text-[15px] text-body">${p}</span>
          </li>`).join('\n')}
        </ul>
      </aside>
    </section>

    <!-- Related. A plain divided list rather than three equal cards. -->
    <section class="py-14 border-line border-t">
      <h2 class="m-0 font-semibold text-ink text-xl tracking-tight">More ${label.toLowerCase()}</h2>
      <ul class="grid gap-0 m-0 mt-6 p-0 list-none divide-line divide-y">
${others.map(o => `        <li>
          <a class="flex gap-4 items-center justify-between py-5 group" href="${base}/${o.slug}" data-stx-link>
            <span class="grid gap-1">
              <span class="font-semibold text-[15px] text-ink">${o.nav}</span>
              <span class="max-w-[60ch] text-[13px] text-muted">${o.summary}</span>
            </span>
            <span class="shrink-0 h-5 w-5 text-muted group-hover:text-ink transition-colors i-hugeicons-arrow-right-01" aria-hidden="true"></span>
          </a>
        </li>`).join('\n')}
      </ul>
    </section>
  </article>
@endsection
`
}

function indexPage(kind: 'feature' | 'use-case', entries: MarketingEntry[]): string {
  const base = kind === 'feature' ? '/features' : '/use-cases'
  const label = kind === 'feature' ? 'Features' : 'Use cases'
  const blurb = kind === 'feature'
    ? 'Everything Postline does, and how each part works.'
    : 'Who runs Postline, and what they use it for.'

  return `@extends('layouts/marketing')

@section('title', '${label} - Postline')
@section('description', '${q(blurb)}')
@section('canonical', '${SITE}${base}')
@section('ogImage', '${SITE}/images/og/${kind}-index.png')

@section('content')
  <div class="mx-auto px-6 max-w-[1400px]">
    <header class="grid gap-5 pb-12 pt-16 lg:pt-20 max-w-2xl">
      <h1 class="m-0 font-semibold leading-[1.05] text-4xl text-ink tracking-tight md:text-6xl">${label}</h1>
      <p class="m-0 leading-relaxed text-body text-lg">${blurb}</p>
    </header>

    <ul class="grid gap-0 m-0 p-0 pb-16 list-none border-line border-t divide-line divide-y">
${entries.map(e => `      <li>
        <a class="grid gap-4 items-start sm:grid-cols-[auto_minmax(0,1fr)_auto] py-6 group" href="${base}/${e.slug}" data-stx-link>
          <span class="grid place-items-center h-10 w-10 text-ink bg-panel border border-line rounded-xl i-hugeicons-${e.icon}" aria-hidden="true"></span>
          <span class="grid gap-1.5">
            <span class="font-semibold text-ink text-lg">${e.nav}</span>
            <span class="max-w-[62ch] leading-relaxed text-body text-sm">${e.summary}</span>
          </span>
          <span class="hidden sm:block self-center h-5 w-5 text-muted group-hover:text-ink transition-colors i-hugeicons-arrow-right-01" aria-hidden="true"></span>
        </a>
      </li>`).join('\n')}
    </ul>
  </div>
@endsection
`
}

const written: string[] = []
const removed: string[] = []

for (const [kind, entries, dir] of [
  ['feature', FEATURES, 'features'],
  ['use-case', USE_CASES, 'use-cases'],
] as const) {
  const outDir = join(root, 'resources/views', dir)
  mkdirSync(outDir, { recursive: true })

  // Remove pages whose slug no longer exists. Without this a renamed entry
  // leaves its old page live and routable — `self-hosting` outlived its rename
  // to `own-your-keys` and shipped to production alongside it.
  const keep = new Set(['index.stx', ...entries.map(entry => `${entry.slug}.stx`)])
  for (const file of readdirSync(outDir)) {
    if (file.endsWith('.stx') && !keep.has(file)) {
      rmSync(join(outDir, file))
      removed.push(`resources/views/${dir}/${file}`)
    }
  }

  writeFileSync(join(outDir, 'index.stx'), indexPage(kind, entries))
  written.push(`resources/views/${dir}/index.stx`)

  for (const entry of entries) {
    writeFileSync(join(outDir, `${entry.slug}.stx`), page(entry, kind, entries))
    written.push(`resources/views/${dir}/${entry.slug}.stx`)
  }
}

// Normalise the generated markup with the project's own linter rather than
// hand-ordering utility classes in the template strings above, so regenerating
// never reintroduces class-order warnings.
const fix = Bun.spawnSync(
  ['bunx', '--bun', 'pickier', 'resources/views/features', 'resources/views/use-cases', '--fix'],
  { cwd: root, stdout: 'ignore', stderr: 'ignore' },
)
if (fix.exitCode !== 0)
  console.warn('pickier --fix did not run cleanly; check class ordering by hand')

// eslint-disable-next-line no-console
if (removed.length)
  console.log(`Removed ${removed.length} stale page(s):\n${removed.map(r => `  ${r}`).join('\n')}`)

// eslint-disable-next-line no-console
console.log(`Generated ${written.length} marketing pages:\n${written.map(w => `  ${w}`).join('\n')}`)
process.exit(0)
