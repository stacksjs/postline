# Seeders

Two separate passes run when you call `buddy seed`, and knowing which does what
saves a lot of confusion:

| Pass | Source | What it is good for |
|---|---|---|
| **Model factories** | `traits.useSeeder` on a model in `app/Models/` | Volume. Plausible-but-random rows, wired up by `belongsTo`. |
| **Application seeders** | the classes in this directory | Specific rows that have to be exactly right: the workspace account, the publication, the fixtures a test asserts on. |

Factories run first, then the seeders here.

## Why the user account is seeded here and not by a factory

`User` is a framework model, not one of ours. The factory pass loads
`app/Models/` and — when that directory has models in it, which it does —
returns *only* those, so no framework default is ever seeded. `--include-defaults`
would pull in all ~105 of them, which is not what anyone wants.

So anything belonging to a framework model is an application seeder's job.
`WorkspaceUser` is why `buddy seed` now leaves you able to sign in; before it
existed, a fresh database had zero users and every app route bounced to
`/login`.

## Writing one

Default-export a class extending `Seeder`:

```ts
import { Seeder } from '@stacksjs/database'

export default class MySeeder extends Seeder {
  static order = 25
  static tags = ['demo']

  async run(): Promise<void> {
    // ...
  }
}
```

- **`order`** — ascending. Files are read in name order, then sorted by this, so
  the number in the filename is only a reading aid; `order` is what counts.
- **`tags`** — selects with `buddy seed --tag <tag>`. Ours:

  | Tag | Meaning |
  |---|---|
  | `core` | The minimum for the app to be usable: an account to sign in with, a publication to write into. Safe anywhere. |
  | `demo` | Content volume, so screens are not empty when you look at them. |
  | `e2e` | Deterministic fixtures. Change these and tests that assert on them change too. |

  A seeder may carry several. `core` + `e2e` means "needed to boot, and tests
  depend on the exact values".

## Rules

1. **Idempotent.** Check before inserting. `buddy seed` twice in a row must not
   produce two publications, and must not throw on a unique constraint.
2. **Deterministic where it is asserted on.** Anything tagged `e2e` uses fixed
   values, never `faker`. Random data belongs in a factory.
3. **No secrets.** The development password below is deliberately well-known and
   the seeder refuses to run outside development. Never seed a real credential.
4. **Order by dependency**, not by preference — a child seeder must not guess at
   a parent id.

## Running

```bash
buddy seed                          # factories, then every seeder here
buddy seed --tag core               # just enough to sign in
buddy seed --skip-models            # seeders only, no random volume
buddy seed --only-seeders WorkspaceUser
buddy seed --fresh                  # truncate first (factory pass)
```

A fresh start, which is what you want before an end-to-end run:

```bash
buddy migrate:fresh --force && buddy seed
```
