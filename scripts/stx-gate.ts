#!/usr/bin/env bun
/**
 * stx pre-merge gate.
 *
 * Adapted from chapter 12 of the stx standards, plus three build-output checks
 * that are Postline-specific. Those exist because a real bug shipped past every
 * other gate: a mis-resolved component put an error string where the sidebar
 * should be on every built page, with no navigation and the developer's home
 * directory leaked into the HTML — and the build still exited 0.
 *
 * RATCHET, NOT A CLIFF. Several checks cannot be zero yet — the composer and
 * the accounts page are still imperative, and that is scheduled work, not an
 * oversight. Each such check carries a BASELINE: the gate fails if a count goes
 * ABOVE it, and also fails if a count drops BELOW it without the baseline being
 * lowered. The second half is the important one — a ratchet that only ever
 * loosens is theatre.
 *
 *   bun run scripts/stx-gate.ts            # check
 *   bun run scripts/stx-gate.ts --update   # rewrite baselines to current counts
 *
 * `--update` is for when you have legitimately cleared violations; it should
 * appear in a diff alongside the change that cleared them, never on its own.
 */
import process from 'node:process'
import { Glob } from 'bun'
import { lintStxStrict } from '@stacksjs/stx'
import { PROHIBITED_DOM_PATTERNS } from '@stacksjs/stx/script-validation'
import { scanScriptTags } from '@stacksjs/stx/signal-processing'

interface Check {
  /** Stable id — used as the baseline key, so renaming resets the ratchet. */
  id: string
  /** What a non-zero count means, in one line. */
  label: string
  /** Why it is not zero yet, and what clears it. Omit when the target is 0. */
  why?: string
  count: () => Promise<number> | number
  /** Offending locations, printed when the count moves. */
  detail?: () => Promise<string[]> | string[]
}

/**
 * Current accepted counts. A number here is a debt, not a target.
 *
 * Every non-zero entry names the phase that clears it. Do not raise one to make
 * the gate pass — that is what the failure is for.
 */
const BASELINE: Record<string, number> = {
  // --- held at zero ---
  'style-block': 0, //            rule 11.1 — cleared, all CSS is in config/crosswind.ts
  'doctype-no-nolayout': 0, //    rule 2.2 — cleared for the app shell; marketing is exempt
  'script-tag-balance': 0, //     a "</script" inside a script body truncates the block
  'comment-landmine': 0, //       html/DOCTYPE/script token inside an HTML comment
  'strict-lint': 0, //            cleared — the 4 real findings were backticks in comments
  'dist-component-error': 0, //   an unresolved component. THIS one shipped broken nav to prod.
  'dist-path-leak': 0, //         absolute developer paths leaked into public HTML
  'dist-layout-published': 0, //  a layout emitted as a public page and put in the sitemap

  // --- debts, each with an owner ---
  'dom-guard': 24, //             composer.stx (11) + accounts.stx (13). The remaining composer
  //                              hits are all document.createElement — cleared by declarative rendering.
  'inline-style-attr': 52, //     mostly the leftover desktop demo; the rest is pre-hydration
  //                              display:none, whose sanctioned form is a :class with literals.
  'plain-internal-anchor': 85, // rule 9 / StxLink. The marketing pages dominate this.
  'unmanaged-timer': 0, //        cleared — composer's two timers are useDebounce now.
}

/**
 * Strict-lint rules that are STALE against the installed stx and produce false
 * positives. Both were verified against @stacksjs/stx@0.2.152 before switching
 * them off — do not disable a rule here without doing the same.
 *
 * `no-bare-function-ref-in-event` claims `@click="fn"` "will not fire". It
 * does. signals.js:1404-1414 matches a bare identifier and returns
 * `($event) => fn($event)`, with a comment citing the fix (stx#1695). The rule
 * still ships and its message is actively misleading — it would have had us
 * "fix" four working handlers, including login's submit.
 *
 * `no-view-level-script-client` claims a view-level `<script client>` is
 * "silently dropped — only components get client scopes". It is not: every
 * symbol from login's and queue's view-level client blocks is present in the
 * built HTML, wrapped in `__stx_setup_` functions.
 */
const STALE_STRICT_RULES: Record<string, boolean> = {
  'stx/no-bare-function-ref-in-event': false,
  'stx/no-view-level-script-client': false,
}

const REQUIRED_CONFIG_KEYS: [key: string, why: string][] = [
  ['strict', 'DOM guard (ch. 12.1) — without it script-validation discards every finding'],
  ['root', 'pins project topology; absent, resolveStxRoot sniffs it and double-prefixes dirs'],
  ['pagesDir', 'must accompany root — resolveStxRoot falls back to a non-existent "pages"'],
]

/**
 * Files a check deliberately ignores.
 *
 * `resources/emails/**` are standalone documents by nature — an email client
 * has no stx runtime. `layouts/marketing.stx` keeps its DOCTYPE until
 * stacksjs/stx#1798 gives generateDocumentShell htmlAttrs support; without it,
 * removing the shell drops the class the landing page's tokens are scoped to.
 */
const DOCTYPE_EXEMPT: string[] = [
  'resources/emails/',
  'resources/layouts/marketing.stx',
  'resources/layouts/Desktop.stx',
]

async function stxFiles(): Promise<string[]> {
  const out: string[] = []
  for await (const f of new Glob('resources/**/*.stx').scan('.')) out.push(f)
  return out.sort()
}

/**
 * Email templates are exempt from the styling and link rules, and it is not a
 * concession: an email client strips `<style>` and has no router, so inline
 * `style=""` and absolute `<a href>` are the only things that work there.
 * Counting them as debt would make the number permanently un-clearable.
 */
function appStx(files: string[]): string[] {
  return files.filter(f => !f.startsWith('resources/emails/'))
}

async function distFiles(): Promise<string[]> {
  const out: string[] = []
  try {
    for await (const f of new Glob('dist/**/*.html').scan('.')) out.push(f)
  }
  catch {
    // no dist/ — the build gates report 0 and print a note instead of failing
  }
  return out.sort()
}

async function grepCount(re: RegExp, files: string[]): Promise<string[]> {
  const hits: string[] = []
  for (const f of files) {
    const src = await Bun.file(f).text()
    const lines = src.split('\n')
    lines.forEach((line, i) => {
      re.lastIndex = 0
      if (re.test(line)) hits.push(`${f}:${i + 1}  ${line.trim().slice(0, 90)}`)
    })
  }
  return hits
}

async function scanStx(): Promise<{
  domGuard: string[]
  strictLint: string[]
  balance: string[]
  commentLandmine: string[]
  doctype: string[]
}> {
  const domGuard: string[] = []
  const strictLint: string[] = []
  const balance: string[] = []
  const commentLandmine: string[] = []
  const doctype: string[] = []

  for (const f of await stxFiles()) {
    const src = await Bun.file(f).text()

    for (const d of lintStxStrict(src, { filePath: f, rules: STALE_STRICT_RULES }) ?? [])
      strictLint.push(`${f}:${d.line}:${d.column}  ${d.ruleId}  ${d.message}`)

    for (const s of scanScriptTags(src, { skipAttrs: /\bserver\b|\bsrc\s*=/ })) {
      for (const { pattern, message, suggestion } of PROHIBITED_DOM_PATTERNS) {
        pattern.lastIndex = 0
        const m = s.body.match(pattern)
        if (m) domGuard.push(`${f}  ${message} x${m.length} -> ${suggestion}`)
      }
    }

    const open = (src.match(/<script\b/gi) ?? []).length
    const close = (src.match(/<\/script\s*>/gi) ?? []).length
    if (open !== close)
      balance.push(`${f}  ${open} <script> vs ${close} </script> — a "</script" sits inside a script body`)

    for (const m of src.matchAll(/<!--([\s\S]*?)-->/g)) {
      if (/<\/?html\b|<!DOCTYPE\b|<\/?script\b/i.test(m[1])) {
        const line = src.slice(0, m.index).split('\n').length
        commentLandmine.push(`${f}:${line}  banned token inside <!-- -->`)
      }
    }

    if (/<!DOCTYPE\s/i.test(src) && !/@nolayout\b/.test(src) && !DOCTYPE_EXEMPT.some(p => f.startsWith(p) || f === p))
      doctype.push(`${f}  <!DOCTYPE> with no @nolayout — layout resolution is silently skipped`)
  }

  return { domGuard, strictLint, balance, commentLandmine, doctype }
}

const scan = await scanStx()
const stx = await stxFiles()
const dist = await distFiles()

const checks: Check[] = [
  {
    id: 'style-block',
    label: 'no <style> block in a .stx file (rule 11.1)',
    count: async () => (await grepCount(/<style/, stx)).length,
    detail: () => grepCount(/<style/, stx),
  },
  {
    id: 'doctype-no-nolayout',
    label: 'no <!DOCTYPE> outside the exempt list (rule 2.2)',
    count: () => scan.doctype.length,
    detail: () => scan.doctype,
  },
  {
    id: 'script-tag-balance',
    label: 'no "</script" inside a script body',
    count: () => scan.balance.length,
    detail: () => scan.balance,
  },
  {
    id: 'comment-landmine',
    label: 'no html/DOCTYPE/script token inside an HTML comment',
    count: () => scan.commentLandmine.length,
    detail: () => scan.commentLandmine,
  },
  {
    id: 'strict-lint',
    label: "stx's own strict linter",
    count: () => scan.strictLint.length,
    detail: () => scan.strictLint,
  },
  {
    id: 'dom-guard',
    label: 'prohibited DOM access in client scripts',
    why: 'composer.stx and accounts.stx are still imperative — the signals migration clears these',
    count: () => scan.domGuard.length,
    detail: () => scan.domGuard,
  },
  {
    id: 'inline-style-attr',
    label: 'no style="" attribute (rule 11.5)',
    why: 'pre-hydration display:none; the sanctioned form is a :class with literal branches',
    count: async () => (await grepCount(/style="/, appStx(stx))).length,
    detail: () => grepCount(/style="/, appStx(stx)),
  },
  {
    id: 'plain-internal-anchor',
    label: 'no plain internal <a href="/"> (rule 9 — use StxLink)',
    why: 'marketing pages dominate this; converting them is its own pass',
    count: async () => (await grepCount(/<a [^>]*href="\//, appStx(stx))).length,
    detail: () => grepCount(/<a [^>]*href="\//, appStx(stx)),
  },
  {
    id: 'unmanaged-timer',
    label: 'no bare setTimeout/setInterval (rule 6.7)',
    why: 'useTimeout()/useDebounce() unsubscribe on destroy; bare timers outlive the SPA swap',
    count: async () => (await grepCount(/(^|[^.\w])(setTimeout|setInterval)\s*\(/, stx)).length,
    detail: () => grepCount(/(^|[^.\w])(setTimeout|setInterval)\s*\(/, stx),
  },
  {
    id: 'dist-component-error',
    label: 'no unresolved component in built HTML',
    count: async () => (await grepCount(/Error loading component/, dist)).length,
    detail: () => grepCount(/Error loading component/, dist),
  },
  {
    id: 'dist-path-leak',
    label: 'no absolute filesystem path in built HTML',
    count: async () => (await grepCount(/\/(Users|home)\/[a-z]/i, dist)).length,
    detail: () => grepCount(/\/(Users|home)\/[a-z]/i, dist),
  },
  {
    id: 'dist-layout-published',
    label: 'no layout emitted as a public page',
    count: () => dist.filter(f => f.startsWith('dist/layouts/')).length,
    detail: () => dist.filter(f => f.startsWith('dist/layouts/')),
  },
]

const update = process.argv.includes('--update')
let failed = 0
let loosened = 0
const next: Record<string, number> = {}

console.log('\n  stx pre-merge gate\n')

// config surface first — a missing key silently disables other checks
const uiConfig = (await import('../config/ui.ts')).default as Record<string, unknown>
for (const [key, why] of REQUIRED_CONFIG_KEYS) {
  if (uiConfig[key] == null) {
    console.log(`  FAIL  config/ui.ts is missing "${key}" — ${why}`)
    failed++
  }
}

for (const check of checks) {
  const got = await check.count()
  const base = BASELINE[check.id] ?? 0
  next[check.id] = got

  if (got > base) {
    console.log(`  FAIL  ${check.label}`)
    console.log(`        ${got} found, baseline ${base}${check.why ? ` (${check.why})` : ''}`)
    for (const line of (await check.detail?.() ?? []).slice(0, 8)) console.log(`          ${line}`)
    failed++
  }
  else if (got < base) {
    console.log(`  DROP  ${check.label}: ${got} < baseline ${base} — lower the baseline (--update)`)
    loosened++
  }
  else {
    console.log(`  ok    ${check.label}${base > 0 ? `  (${got}, held)` : ''}`)
  }
}

if (!dist.length)
  console.log('\n  note: dist/ is empty — build-output checks did not run. Run `./buddy build` first.')

if (update) {
  const path = new URL(import.meta.url).pathname
  const src = await Bun.file(path).text()
  const body = Object.entries(next)
    .map(([k, v]) => `  '${k}': ${v},`)
    .join('\n')
  console.log('\n  --update: new counts\n')
  console.log(body)
  console.log('\n  Paste these into BASELINE, keeping the comments.')
  void src
}

if (loosened && !update)
  console.log(`\n  ${loosened} check(s) improved. Lower their baselines so the ratchet holds.`)

if (failed)
  console.log(`\n  ${failed} gate(s) failed.\n`)
else if (loosened)
  console.log(`\n  No regressions — but ${loosened} baseline(s) are now stale.\n`)
else
  console.log('\n  All gates pass.\n')
process.exit(failed || loosened ? 1 : 0)
