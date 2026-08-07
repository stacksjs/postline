#!/bin/sh
# Type-check the app with the native TypeScript compiler.
#
# This deliberately runs no JavaScript. bunfig.toml preloads the whole framework
# into every Bun runtime process, and on linux-x64 under Bun 1.3.0 that preload
# segfaults: CI runs 31123344401 and 31144241659 both died with SIGILL and a
# "Bun has crashed" panic before tsc had looked at a single type, taking
# deploy-production down with them. It passes on macOS under a newer Bun, which
# is the worst shape for this kind of bug to have.
#
# TypeScript 7 is the Go port, so the compiler is a native binary that needs no
# runtime host at all. exec'ing it straight from sh means the preload is never
# loaded, on any platform and any Bun version — and it is faster besides.
#
#   sh scripts/typecheck.sh [...extra tsc args]
set -e

cd "$(dirname "$0")/.." || exit 1

# The platform packages are optional dependencies gated on os/cpu, so only the
# one matching this machine is ever installed and the glob is unambiguous. An
# unmatched glob stays literal, which the -x test below rejects like any other
# missing binary.
exe=''
for candidate in node_modules/@typescript/typescript-*/lib/tsc; do
  if [ -x "$candidate" ]; then
    exe="$candidate"
    break
  fi
done

if [ -z "$exe" ]; then
  echo "No native tsc binary under node_modules/@typescript. Run \`bun install\`, or check that TypeScript supports this platform." >&2
  exit 1
fi

exec "$exe" --noEmit -p tsconfig.json --pretty false "$@"
