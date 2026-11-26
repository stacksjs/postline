/**
 * Generate the marketing feature and use-case pages from the catalog.
 *
 * stx routes from the filesystem, so each entry needs a real `.stx` file rather
 * than one dynamic route. Generating them keeps every page consistent: change
 * the shape here once instead of editing each file by hand.
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
const REPO = 'https://github.com/stacksjs/postline'

/** Escape for a single-quoted stx `@section` argument. */
function q(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/** Escape text placed in HTML: catalog copy is prose, and prose has ampersands. */
function h(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function page(entry: MarketingEntry, kind: 'feature' | 'use-case', siblings: MarketingEntry[]): string {
  const base = kind === 'feature' ? '/features' : '/use-cases'
  const label = kind === 'feature' ? 'Features' : 'Use cases'
  const others = siblings.filter(s => s.slug !== entry.slug).slice(0, 3)

  return `@extends('layouts/marketing')

@section('title', '${q(entry.nav)}: ${q(entry.title)} - Postline')
@section('description', '${q(entry.summary)}')
@section('canonical', '${SITE}${base}/${entry.slug}')
@section('ogImage', '${SITE}/images/og/${kind}-${entry.slug}.png')
@section('ogImageAlt', '${q(`Postline ${kind === 'feature' ? 'feature' : 'use case'}: ${entry.nav}. ${entry.title}.`)}')

@section('content')
  <article class="mx-auto px-5 sm:px-8 max-w-[1200px]">
    <header class="grid gap-6 pb-14 pt-14 sm:pt-20 max-w-[46rem]">
      <nav class="flex gap-2 items-center text-[13px] text-muted" aria-label="Breadcrumb">
        <a class="hover:text-ink transition-colors" href="/" data-stx-link>Postline</a>
        <span aria-hidden="true">/</span>
        <a class="hover:text-ink transition-colors" href="${base}" data-stx-link>${label}</a>
      </nav>
      <span class="grid place-items-center h-12 w-12 text-ink text-xl bg-panel border border-line rounded-2xl" aria-hidden="true"><span class="i-hugeicons-${entry.icon}"></span></span>
      <h1 class="m-0 leading-[1.04] text-4xl text-ink sm:text-6xl">${h(entry.title)}</h1>
      <p class="m-0 max-w-[60ch] leading-relaxed text-[17px] text-body sm:text-lg">${h(entry.intro)}</p>
      <div class="flex flex-wrap gap-3 items-center">
        <a class="inline-flex gap-2 items-center px-5 h-11 font-medium text-[15px] text-on-accent bg-accent rounded-xl hover:opacity-90 transition-opacity" href="/login" data-stx-link>Get started<span class="h-4 w-4 i-hugeicons-arrow-right-01" aria-hidden="true"></span></a>
        <a class="inline-flex gap-2 items-center px-5 h-11 font-medium text-[15px] text-ink bg-panel hover:bg-panel-2 border border-line rounded-xl transition-colors" href="${REPO}"><span class="h-4 w-4 i-simple-icons-github" aria-hidden="true"></span>Read the source</a>
      </div>
    </header>

    <section class="grid gap-10 lg:gap-16 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] py-14 border-line border-t">
      <div class="grid gap-10">
${entry.sections.map(s => `        <div class="grid gap-3 max-w-[62ch]">
          <h2 class="m-0 text-2xl text-ink">${h(s.heading)}</h2>
          <p class="m-0 leading-relaxed text-[16px] text-body">${h(s.body)}</p>
        </div>`).join('\n')}
      </div>

      <aside class="lg:pt-1">
        <div class="p-6 bg-panel border border-line rounded-2xl">
          <p class="m-0 eyebrow">In short</p>
          <ul class="grid gap-4 m-0 mt-5 p-0 list-none">
${entry.points.map(p => `            <li class="flex gap-3 items-start">
              <span class="shrink-0 mt-0.5 h-5 w-5 text-ink i-hugeicons-checkmark-circle-02" aria-hidden="true"></span>
              <span class="text-[15px] text-body">${h(p)}</span>
            </li>`).join('\n')}
          </ul>
        </div>
      </aside>
    </section>

    <section class="pb-20 pt-14 border-line border-t">
      <h2 class="m-0 text-ink text-xl">More ${label.toLowerCase()}</h2>
      <ul class="grid gap-4 md:grid-cols-3 m-0 mt-6 p-0 list-none">
${others.map(o => `        <li>
          <a class="grid content-start gap-3 p-5 h-full bg-panel hover:bg-panel-2 border border-line rounded-2xl transition-colors" href="${base}/${o.slug}" data-stx-link>
            <span class="grid place-items-center h-9 w-9 text-ink bg-panel-2 border border-line rounded-xl" aria-hidden="true"><span class="i-hugeicons-${o.icon}"></span></span>
            <span class="font-semibold text-[15px] text-ink">${h(o.nav)}</span>
            <span class="leading-relaxed text-[13.5px] text-muted">${h(o.summary)}</span>
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
@section('description', '${q(`${kind === 'feature' ? 'Postline features' : 'Postline use cases'}: ${entries.map(e => e.nav).join(', ')}.`)}')
@section('canonical', '${SITE}${base}')
@section('ogImage', '${SITE}/images/og/${kind}-index.png')
@section('ogImageAlt', '${q(kind === 'feature' ? 'Postline features: what each part does.' : 'Postline use cases: who runs it, and for what.')}')

@section('content')
  <div class="mx-auto px-5 sm:px-8 max-w-[1200px]">
    <header class="grid gap-5 pb-12 pt-14 sm:pt-20 max-w-[42rem]">
      <p class="m-0 eyebrow">${label}</p>
      <h1 class="m-0 leading-[1.04] text-4xl text-ink sm:text-6xl">${kind === 'feature' ? 'What Postline does.' : 'Who Postline is for.'}</h1>
      <p class="m-0 leading-relaxed text-[17px] text-body sm:text-lg">${blurb}</p>
    </header>

    <ul class="grid gap-4 md:grid-cols-2 lg:grid-cols-3 m-0 p-0 pb-20 list-none">
${entries.map(e => `      <li>
        <a class="grid content-start gap-4 p-6 h-full bg-panel hover:bg-panel-2 border border-line rounded-2xl transition-colors" href="${base}/${e.slug}" data-stx-link>
          <span class="grid place-items-center h-10 w-10 text-ink text-lg bg-panel-2 border border-line rounded-xl" aria-hidden="true"><span class="i-hugeicons-${e.icon}"></span></span>
          <span class="grid gap-2">
            <span class="font-semibold text-[17px] text-ink">${h(e.nav)}</span>
            <span class="leading-relaxed text-[14.5px] text-body">${h(e.summary)}</span>
          </span>
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
