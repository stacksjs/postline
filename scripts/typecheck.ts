/**
 * Type-check the app with the native TypeScript compiler.
 *
 * TypeScript 7 is the Go port, so `node_modules/typescript/bin/tsc` is only a
 * shim whose job is to hand off to a platform-specific binary — and it prefers
 * `process.execve` to do it. Bun 1.3.0 segfaults inside that call on linux-x64,
 * which is why CI run 31123344401 failed with a "Bun has crashed" panic and
 * SIGILL rather than a type error, taking the deploy down with it. Resolving
 * the binary and spawning it here keeps the shim, and the crash, off the path
 * on every platform and every Bun version.
 *
 *   bun scripts/typecheck.ts [...extra tsc args]
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import process from 'node:process'

const platformPackage = `@typescript/typescript-${process.platform}-${process.arch}`

let exe: string
try {
  // package.json is the only path the platform package exports; the binary sits
  // beside it in lib/, named after the wrapper's sole bin entry.
  const packageJson = Bun.resolveSync(`${platformPackage}/package.json`, import.meta.dir)
  exe = join(dirname(packageJson), 'lib', process.platform === 'win32' ? 'tsc.exe' : 'tsc')
}
catch {
  console.error(`Unable to resolve ${platformPackage}. Run \`bun install\`, or check that TypeScript supports this platform.`)
  process.exit(1)
}

const { status, signal } = spawnSync(exe, ['--noEmit', '-p', 'tsconfig.json', '--pretty', 'false', ...process.argv.slice(2)], {
  cwd: join(import.meta.dir, '..'),
  stdio: 'inherit',
})

if (signal) {
  console.error(`tsc was terminated by ${signal}`)
  process.exit(1)
}

process.exit(status ?? 1)
