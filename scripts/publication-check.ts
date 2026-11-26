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
 * `POSTLINE_RELEASE_SKIP_CI_STATUS=1` skips only the first, for a release cut
 * while the CI runner is offline (docs/ci.md); the local checks always run.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const REPOSITORY = 'stacksjs/postline'
const CI_CONTEXT = 'ReviewOS / CI'

function run(label: string, command: string, args: string[], options: { cwd?: string } = {}): void {
  console.log(`\n▸ ${label}`)
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: options.cwd, env: process.env })
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
  console.error(`\n✗ Release refused: ${message}`)
  process.exit(1)
}

/** The CI verdict GitHub holds for a commit: 'success', 'failure', 'pending', or 'missing'. */
export function ciState(statuses: Array<{ context?: string, state?: string }>): string {
  const ours = statuses.find(status => status.context === CI_CONTEXT)
  return ours?.state || 'missing'
}

async function checkWebCi(sha: string): Promise<void> {
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/commits/${sha}/status`, {
    headers: { accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) fail(`GitHub could not return the status for ${sha.slice(0, 9)} (HTTP ${response.status}).`)
  const data = await response.json() as { statuses?: Array<{ context?: string, state?: string }> }
  const state = ciState(data.statuses ?? [])
  if (state !== 'success') fail(`ReviewOS CI on ${sha.slice(0, 9)} is ${state}. Deploy a commit CI passed.`)
  console.log(`▸ CI status: ${CI_CONTEXT} passed on ${sha.slice(0, 9)}`)
}

if (import.meta.main) {
  const sha = output('git', ['rev-parse', 'HEAD'])

  if (output('git', ['status', '--porcelain', '--untracked-files=no']))
    fail('the working tree has uncommitted changes. Release a commit, not a working tree.')

  if (process.env.STACKS_PUBLICATION_CHANNEL === 'web') {
    await checkWebCi(sha)
    process.exit(0)
  }

  if (process.env.POSTLINE_RELEASE_SKIP_CI_STATUS === '1') {
    console.log('▸ CI status: skipped (POSTLINE_RELEASE_SKIP_CI_STATUS=1)')
  }
  else {
    output('git', ['fetch', '--quiet', 'origin'])
    if (!output('git', ['branch', '-r', '--contains', sha]))
      fail(`${sha.slice(0, 9)} is not on GitHub yet. Push it and let CI run first.`)

    const statuses = JSON.parse(output('gh', ['api', `repos/${REPOSITORY}/commits/${sha}/statuses`, '--paginate', '--slurp'])).flat()
    const state = ciState(statuses)
    if (state !== 'success')
      fail(`CI on ${sha.slice(0, 9)} is ${state === 'missing' ? 'not reported yet' : state}. Release only a commit CI passed.`)
    console.log(`▸ CI status: ${CI_CONTEXT} passed on ${sha.slice(0, 9)}`)
  }

  run('Lint', 'bun', ['run', 'lint'])
  run('Lint stx templates', './buddy', ['lint', '--stx'])
  run('Type check', 'bun', ['run', 'typecheck:app'])
  run('Tests', './buddy', ['test'])
  run('Desktop bundle', 'bun', ['scripts/desktop-bundle.ts'])

  const scratch = mkdtempSync(join(tmpdir(), 'postline-release-check-'))
  try {
    const binary = join(scratch, 'postline-check')
    run('Compile desktop check', 'bun', ['build', '--compile', 'scripts/desktop-check.ts', '--outfile', binary])
    run('Desktop check', binary, [], { cwd: scratch })
  }
  finally {
    rmSync(scratch, { recursive: true, force: true })
  }

  console.log('\n✓ Release checks passed.')
}
