# Contributing to Postline

Thanks for helping. Postline is a social publishing app built on
[Stacks](https://stacksjs.com) (Bun, TypeScript, stx).

## Getting set up

Follow "Getting started" in the [README](../README.md). You need Bun and
SQLite; `./bootstrap` installs the pinned versions.

`./buddy seed` creates a workspace account you can sign in with locally.

## Before you open a pull request

```bash
bunx --bun pickier . --fix
```

```bash
bun run typecheck:app
```

```bash
bun run test
```

The test suite runs on a database of its own, so it is safe to run next to
your development data.

## Conventions

- Conventional commit messages: `fix:`, `feat:`, `chore:` and so on.
- Templates are stx. No `document.*` or `window.*` in a template; use signals
  and composables.
- Styling is utility classes and the tokens in the CSS config. No hand-rolled
  SVG icons; icons are Iconify classes.
- A table comes from its model in `app/Models`. Do not hand-write migrations.
- A route that answers without a session has to be added to
  `tests/feature/public-routes.test.ts` on purpose, with the reason.

`AGENTS.md` has the same rules in the form AI coding agents read.

## Where work is tracked

The plan for the 1.0 release is [docs/production-plan.md](../docs/production-plan.md),
with one epic per phase in the issue tracker. If you want to pick something up,
comment on its issue first.

## Security

Do not open a public issue for a security problem. See [SECURITY.md](SECURITY.md).
