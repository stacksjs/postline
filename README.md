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
| **Inbox** | Direct messages from Bluesky and Mastodon (an app password with message access) in one list. X messages are not supported yet |
| **Listening** | Keyword rules across Bluesky, X and Mastodon, checked every five minutes |
| **Analytics** | Publishing activity for every network; likes, reposts and replies synced for Bluesky posts, against the post that earned them |
| **Cleanup** | Delete posts older than a set number of days, or clear an account, with a preview first |
| **Blog** | Write long-form posts under Writing and publish them to your own site |

## Requirements

- [Bun](https://bun.sh) 1.3.14 or newer (`./bootstrap` installs the pinned version through Pantry)
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

The database is `database/postline.sqlite`. A checkout from before the rename
may still have `database/opentimes.sqlite`. With Postline stopped, move it
together with its `-wal` and `-shm` files (the most recent writes live there)
and point `.env` at the new name; nothing else changes.

```bash
for f in database/opentimes.sqlite*; do mv "$f" "${f/opentimes/postline}"; done && sed -i '' 's#database/opentimes.sqlite#database/postline.sqlite#' .env
```

```bash
./buddy dev
```

Open the address it prints and create the workspace account (**First run?
Create the workspace account**); see [docs/first-run.md](docs/first-run.md).
For sample data while developing, `./buddy seed` adds an account
(`dev@postline.test`, password printed, or set `SEED_USER_PASSWORD`) and a few
posts instead.

### If you lose the password

Postline has one account and no "forgot password" email. Reset it from the
machine it runs on:

```bash
./buddy user:add you@example.com --update
```

That prints a new password once. Add `--password` to choose your own. The Mac
app has no sign-in, so there is nothing to recover there.

`./buddy dev` prints the URLs it is serving. If a port is taken it moves to the
next free one and says so. Run `./buddy setup:ssl` once to get
`https://postline.localhost` in place of a localhost port.

`./buddy dev` also runs the scheduler, so a post scheduled for a minute from
now goes out a minute from now. On a server without `buddy dev`, run it
alongside the app with `./buddy schedule:run`; the Queue and Activity pages say when
it has stopped.

`/` opens the workspace (or the sign-in page). The pages that describe
Postline, its landing page, features, use cases and the hosted-plan waitlist,
belong to the public site and redirect to the workspace on your install. To
work on them, start the site with `POSTLINE_SITE=marketing ./buddy dev`; the
deployment that serves postline.stacksjs.com runs with that setting too.

## Connecting networks

Each network has a page with the exact steps, the permissions Postline asks
for, costs and limits, and what it cannot do: [docs/networks](docs/networks/index.md).
A network with nothing connected shows as "not connected" and nothing else
depends on it, so start with one.

| Network | What you need |
|---|---|
| [Bluesky](docs/networks/bluesky.md) | A handle and an app password. No developer account |
| [Mastodon](docs/networks/mastodon.md) | Your instance URL and an access token |
| [X](docs/networks/x.md) | An OAuth 2.0 app. X bills API use per post |
| [LinkedIn](docs/networks/linkedin.md) | An app with Sign In with LinkedIn using OpenID Connect and Share on LinkedIn |
| [Instagram](docs/networks/instagram.md) | A Meta app, a Business or Creator account and a Facebook Page |
| [Threads](docs/networks/threads.md) | A Meta app with the Threads API |

OAuth callbacks are `https://<your host>/api/postline/<network>/callback`, with
`twitter` for X.

### AI for campaign planning

Optional. Campaign planning drafts posts with Anthropic, OpenAI or a local
Ollama model when one is set up, and with a built-in planner otherwise. Set it
in **Settings > AI** (the key is stored encrypted), or in `.env` with
`AI_PROVIDER`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `OLLAMA_HOST`. Settings
wins when both are set. The Mac app reads no `.env`, so it uses Settings.

## Commands

| Command | What it does |
|---|---|
| `./buddy dev` | Start the site, the API, the docs and the scheduler that publishes queued posts |
| `./buddy dev:frontend` / `./buddy dev:api` | Start one of them |
| `./buddy migrate` | Apply pending migrations |
| `./buddy seed` | Seed the workspace account and sample posts |
| `./buddy test` | Run the suite |
| `./buddy lint` | Lint; `./buddy lint:fix` fixes what it can |
| `bun run typecheck:app` | Type check everything that ships: `app/`, `config/`, `routes/`, `scripts/`, `tests/`, `database/` and the client scripts |
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
| `config/css.ts` | Every design token, and every style a utility class cannot express |
| `config/domains.ts` | The canonical host and the hosts that redirect to it |
| `routes/` | Route files, registered in `app/Routes.ts` |
| `tests/` | Bun test suites |
| `docs/` | Design notes and runbooks |

## Desktop app

Postline builds into a Mac app that runs itself: the workspace and the API are
served from inside the app, and your data lives in
`~/Library/Application Support/Postline`.

```bash
bun scripts/desktop-bundle.ts
```

```bash
./buddy build:desktop
```

```bash
open storage/framework/desktop/webview/darwin-arm64/Postline.app
```

[docs/desktop.md](docs/desktop.md) covers how it is put together, upgrades,
releases and what is not done.

## Running it on a server

[docs/self-hosting.md](docs/self-hosting.md) covers the address, HTTPS (needed
beyond your own machine, also on a local network) and what to set. Run the app
with `./buddy serve` and the scheduler beside it with `./buddy schedule:run`.

## CI

CI runs on [ReviewOS](https://reviewos.org) from `.reviewos/workflows`: lint,
type check, the test suite, the compiled Mac app's agent and a static build of
the site on every push, and the desktop release on a `v*` tag.
[docs/ci.md](docs/ci.md) covers the setup and how to read a run. Nothing
deploys the hosted site from CI yet: it waits for Postline's own host.

## Releasing

```bash
bun run release:minor
```

That bumps the version, writes the changelog, tags and pushes. The tag builds
the app on Postline's Mac runner and publishes a GitHub release with the DMG
attached, through the [Pantry](https://github.com/pantry-pm/pantry) action.

## Contributing

Run these before opening a pull request:

```bash
./buddy lint
```

```bash
bun run typecheck:app
```

```bash
./buddy test
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org).
`AGENTS.md` records the project rules for people and coding agents alike.

## License

MIT. See [LICENSE.md](LICENSE.md).
