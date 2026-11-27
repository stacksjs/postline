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
| **Analytics** | Publishing activity for every network, with likes, reposts and replies for Bluesky and Mastodon posts |
| **Cleanup** | Delete posts older than a set number of days, or clear an account, with a preview first |
| **Blog** | Write long-form posts under Writing and publish them to your own site |

## Requirements

- [Bun](https://bun.sh) 1.3.14 or newer
- SQLite 3.47.2 or newer

## Getting started

In a fresh clone, use the Pantry-managed setup to install the toolchain and
initialize the workspace.

<!-- readme-bootstrap -->
```bash
./bootstrap
```
<!-- /readme-bootstrap -->

If you already have Bun and SQLite, you can set up the workspace manually
with these commands. Keep the `.env` and its application key for later launches.

<!-- readme-setup -->
```bash
bun install --frozen-lockfile
cp .env.example .env
./buddy key:generate
./buddy migrate
```
<!-- /readme-setup -->

Start Postline locally in a browser.

<!-- readme-start -->
```bash
APP_URL=localhost ./buddy dev --browser --with-localhost
```
<!-- /readme-start -->

Open `/setup` at the address it prints. Create the owner account, name the
workspace, and choose where to publish your first post. See the
[first-run guide](docs/first-run.md).
For sample data on a fresh development workspace, run the seeder before
creating an account. It adds `dev@postline.test` and a few posts. It prints
the generated password, or you can set `SEED_USER_PASSWORD` yourself.

<!-- readme-seed -->
```bash
./buddy seed
```
<!-- /readme-seed -->

The dev command prints the address it is serving. If a port is taken it moves
to the next free one. The [first-run guide](docs/first-run.md) covers password
and authenticator recovery on the server.

`./buddy dev` also runs the scheduler, so a post scheduled for a minute from
now goes out a minute from now. On a server without `buddy dev`, run it
alongside the app with `./buddy schedule:run`; the Queue and Activity pages say when
it has stopped.

`/` opens the workspace (or the sign-in page). The pages that describe
Postline, its landing page, features, use cases and the hosted-plan waitlist,
belong to the public site and redirect to the workspace on your install. To
work on them, start the site with this command. The production deployment for
`postline.theopentimes.org` uses the same setting.

<!-- readme-marketing-start -->
```bash
POSTLINE_SITE=marketing ./buddy dev
```
<!-- /readme-marketing-start -->

## Connecting networks

Each network has a page with the exact steps, the permissions Postline asks
for, costs and limits, and what it cannot do: [docs/networks](docs/networks/index.md).
A network with nothing connected shows as "not connected" and nothing else
depends on it, so start with one.

| Network | What you need |
|---|---|
| [Bluesky](docs/networks/bluesky.md) | A handle and an app password. No developer account |
| [Mastodon](docs/networks/mastodon.md) | Your instance URL and an access token |
| [X](docs/networks/x.md) | An OAuth 2.0 app for publishing. The Mac app can also read visible posts from your X browser session |
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

After editing `app/Support/Marketing/catalog.ts`, regenerate its pages and share cards.

<!-- readme-marketing-build -->
```bash
bun scripts/marketing-build.ts
bun scripts/marketing-og.ts
```
<!-- /readme-marketing-build -->

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
| `docs/` | User guides, design notes, and runbooks |

## Desktop app

The Mac app runs the workspace and API locally and stores data in
`~/Library/Application Support/Postline`. See the [Mac installation
guide](docs/install-mac.md) for downloads and the [desktop development
guide](docs/desktop.md) for building from source.

## Running it on a server

[docs/self-hosting.md](docs/self-hosting.md) covers the address, HTTPS (needed
beyond your own machine, also on a local network) and what to set. The Docker
image starts all three services. For a source install, run each of these in its
own service. The API listens on port 3008 by default. If you change that port,
export the same `PORT_API` for the web and API services.

<!-- readme-serve -->
```bash
./buddy serve
./buddy serve:api --port "${PORT_API:-3008}"
./buddy schedule:run
```
<!-- /readme-serve -->

## Automation

Create drafts and schedule posts from scripts using the [Postline CLI and scoped API](docs/automation.md).

## CI

CI runs on [ReviewOS](https://reviewos.org) from `.reviewos/workflows`. On
every push it runs lint, type check, the tests, the compiled Mac agent, the site
build, and browser checks. Manual workflows deploy passing `main` commits and
publish approved desktop tags after CI passes.
[docs/ci.md](docs/ci.md) covers setup, deployments, and how to read a run.

## Releasing

Follow the [release checklist](docs/releasing.md) to prepare and publish a
desktop release for an approved version tag.

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

See [product terms](docs/index.md#product-terms) for the language used in Postline and its documentation.

## License

MIT. See [LICENSE.md](LICENSE.md).
