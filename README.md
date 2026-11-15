# Postline

Write a post once and publish it to every network you use. Postline sends one
draft to Bluesky, X, LinkedIn, Instagram, Threads and Mastodon, then keeps the
queue, the replies and the numbers in one place.

It is open source and runs on your own machine, so the access tokens that let
it post as you never leave it.

- **Built on:** [Stacks](https://stacksjs.com) (Bun, TypeScript, stx)
- **License:** MIT
- **Used by:** [The Open Times](https://github.com/stacksjs/theopentimes.org), which syndicates its stories with the same engine

## What it does

| | |
|---|---|
| **Composer** | One draft, counted against each network's limit, to as many accounts as you pick. Threads chain where a network supports replies |
| **Per-network variants** | Give one network its own wording without forking the draft |
| **Queue** | Drafts, scheduled posts and failures in one list or on a calendar, in your own timezone |
| **Campaigns** | Lay a launch out across weeks, have an assistant draft the sequence, then move it into the queue in one step |
| **Inbox** | Direct messages from Bluesky, X, Mastodon and Instagram in one list |
| **Listening** | Keyword rules across Bluesky, X and Mastodon, checked every five minutes |
| **Analytics** | Likes, reposts and replies stored per network, against the post that earned them |
| **Cleanup** | Delete posts older than a set number of days, or clear an account, with a preview first |
| **Blog** | Publish long-form posts to your own site from the same composer |

## Requirements

- [Bun](https://bun.sh) 1.3 or newer (`./bootstrap` installs the pinned version through Pantry)
- SQLite 3.47.2 or newer

## Getting started

```bash
./bootstrap
```

```bash
cp .env.example .env
```

```bash
./buddy key:generate
```

```bash
./buddy migrate
```

```bash
./buddy seed
```

```bash
./buddy dev
```

`./buddy seed` creates a workspace account you can sign in with
(`dev@postline.test`; the seeder prints the password, and `SEED_USER_PASSWORD`
overrides it) and a few sample posts.

`./buddy dev` prints the URLs it is serving. If a port is taken it moves to the
next free one and says so. Run `./buddy setup:ssl` once to get
`https://postline.localhost` in place of a localhost port.

## Connecting networks

Each network needs credentials of its own, and `.env.example` documents every
one inline. A network with no credentials shows as "not connected" and nothing
else depends on it, so start with one.

| Network | What you need |
|---|---|
| Bluesky | A handle and an app password. No developer account |
| Mastodon | Your instance URL and an access token |
| X | An OAuth 2.0 app. X bills API use per request |
| LinkedIn | An app with the Share on LinkedIn product |
| Instagram, Threads | A Meta app with the matching product |

OAuth callbacks are `https://<your host>/api/postline/<network>/callback`.

## Commands

| Command | What it does |
|---|---|
| `./buddy dev` | Start the site, the API and the docs |
| `./buddy dev:frontend` / `./buddy dev:api` | Start one of them |
| `./buddy dev:dashboard` | The Stacks admin dashboard |
| `./buddy migrate` | Apply pending migrations |
| `./buddy seed` | Seed the workspace account and sample posts |
| `./buddy test` | Run the suite |
| `./buddy lint` | Lint; `./buddy lint:fix` fixes what it can |
| `bun run typecheck` | Type check `app/`, `config/` and `routes/` |
| `./buddy upgrade` | Move to the latest Stacks release |
| `bun scripts/marketing-build.ts` | Regenerate the feature and use-case pages from `app/Support/Marketing/catalog.ts` |
| `bun scripts/marketing-og.ts` | Regenerate the Open Graph cards |

## Where things live

| Path | What lives here |
|---|---|
| `app/Actions/Postline/` | One action per API endpoint |
| `app/Services/Social/` | The queue, cross-posting and one driver per network |
| `app/Services/` | Campaigns, inbox, listening, retention, imports |
| `app/Models/` | The schema. Migrations are generated from these, never written by hand |
| `resources/views/` | The marketing site and the workspace, as stx templates |
| `resources/components/Marketing/` | The marketing site's header, footer and waitlist form |
| `config/crosswind.ts` | Every design token, and every style a utility class cannot express |
| `config/domains.ts` | The canonical host and the hosts that redirect to it |
| `routes/` | Route files, registered in `app/Routes.ts` |
| `tests/` | Bun test suites |
| `docs/` | Design notes and runbooks |

## Desktop app

Postline builds into a native macOS app, a [Craft](https://github.com/craft-native/craft)
window around a running Postline:

```bash
DESKTOP_URL=https://your-postline.example.com/composer ./buddy build:desktop
```

```bash
./buddy build:dmg
```

The app opens the address in `DESKTOP_URL`; it does not contain the server yet.
[docs/desktop.md](docs/desktop.md) covers signing, releases and the Mac App
Store.

## Deploying

Automatic deploys are off. `.github/workflows/ci.yml` lints, type checks and
tests every push; its deploy job runs only when you start the workflow by hand
with **deploy** ticked.

Before the first deploy, Postline needs a home of its own: a host in
`config/domains.ts`, a server in `config/cloud.ts`, and the deploy secrets in
the repository. Until then `config/cloud.ts` still describes the server this
code shared with The Open Times, and deploying to it would collide.

## Releasing

Set the repository variable `DESKTOP_URL` first, then:

```bash
bun run release:minor
```

That bumps the version, writes the changelog, tags and pushes. The tag builds
the DMG and publishes a GitHub release with it attached, through the
[Pantry](https://github.com/pantry-pm/pantry) action.

## Contributing

Run these before opening a pull request:

```bash
./buddy lint
```

```bash
bun run typecheck
```

```bash
./buddy test
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org).
`AGENTS.md` records the project rules for people and coding agents alike.

## License

MIT. See [LICENSE.md](LICENSE.md).
