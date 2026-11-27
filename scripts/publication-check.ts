/**
 * Stacks runs `publication:check` before shipping. Website deployment requires
 * the checked commit's CI verdict. Desktop and GitHub releases also rerun the
 * local checks before publishing an artifact or creating a tag (#234).
 *
 * Two things must hold:
 *
 * 1. The commit being released is on GitHub and ReviewOS CI passed on it. A
 *    release is a commit CI has already judged; v0.1.0 was tagged on a red
 *    commit, reverted and tagged again.
 * 2. The checks CI runs pass here too, plus the compiled desktop check that
 *    the release builds: lint, the stx checks, the type check, the tests.
 *
 */
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const REPOSITORY = 'stacksjs/postline'
const CI_CONTEXT = 'ReviewOS / CI'

function run(label: string, command: string, args: string[]): void {
  console.log(`\n▸ ${label}`)
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env })
  if (result.status !== 0)
    fail(`${label} failed.`)
}

function output(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.status !== 0)
    fail(`\`${command} ${args.join(' ')}\` failed: ${(result.stderr || '').trim()}`)
  return String(result.stdout).trim()
}

function fail(message: string): never {
  console.error(`\n✗ Publication refused: ${message}`)
  process.exit(1)
}

/** The CI verdict GitHub holds for a commit: 'success', 'failure', 'pending', or 'missing'. */
export function ciState(statuses: Array<{ context?: string, state?: string }>): string {
  const ours = statuses.find(status => status.context === CI_CONTEXT)
  return ours?.state || 'missing'
}

async function checkCi(sha: string): Promise<void> {
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/commits/${sha}/status`, {
    headers: { accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) fail(`GitHub could not return the status for ${sha.slice(0, 9)} (HTTP ${response.status}).`)
  const data = await response.json() as { statuses?: Array<{ context?: string, state?: string }> }
  const state = ciState(data.statuses ?? [])
  if (state !== 'success') fail(`ReviewOS CI on ${sha.slice(0, 9)} is ${state}. Publish a commit CI passed.`)
  console.log(`▸ CI status: ${CI_CONTEXT} passed on ${sha.slice(0, 9)}`)
}

if (import.meta.main) {
  const sha = output('git', ['rev-parse', 'HEAD'])
  const ciOnly = process.env.STACKS_PUBLICATION_CHANNEL === 'web' || process.argv[2] === '--ci-only'

  if (output('git', ['status', '--porcelain', '--untracked-files=no']))
    fail('the working tree has uncommitted changes. Release a commit, not a working tree.')

  if (!ciOnly) {
    output('git', ['fetch', '--quiet', 'origin'])
    if (!output('git', ['branch', '-r', '--contains', sha]))
      fail(`${sha.slice(0, 9)} is not on GitHub yet. Push it and let CI run first.`)
  }
  await checkCi(sha)
  if (ciOnly) process.exit(0)

  run('Lint', 'bun', ['run', 'lint'])
  run('Lint stx templates', './buddy', ['lint', '--stx'])
  run('Type check', 'bun', ['run', 'typecheck:app'])
  run('Tests', './buddy', ['test'])
  run('Desktop check', 'bun', ['scripts/desktop-check.ts'])

  console.log('\n✓ Release checks passed.')
}
