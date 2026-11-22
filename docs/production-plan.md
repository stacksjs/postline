# Postline production plan

Revised 2026-11-22 against `main` at `ebe8a032` (v0.1.1, Stacks 0.75.628, stx 0.2.913).

This plan takes Postline from a working v0.1 to a release that is safe to hand to
strangers, reliable at its one core promise (a scheduled post goes out once, on
time, to every network), honest about what it does, fast, and consistent to
look at. It keeps the current look: neutral surfaces, one accent, quiet type.

It rests on six code audits (backend, frontend, desktop and CI, network APIs,
public site and docs, platform hardening), a pass through every screen in light,
dark and phone width on a scratch database, and a production build. Items marked
**(seen)** were reproduced, not only read.

Every task is a GitHub issue, filed on 2026-11-22, with one epic per phase.
Each issue body carries its plan id (for example `G01`).

## What "production ready" means here

Two shipping targets:

1. **The Mac app.** Signed, notarized, self-updating, and able to connect all
   six networks without the user touching a file.
2. **Self-hosted, single workspace.** One owner, one instance, secure with the
   defaults `.env.example` ships.

Hosted multi-user Postline stays out of this plan. No model carries a user or
workspace id, registration closes after the first account, and credentials are
one set per instance. The site keeps saying "Hosted: coming soon".

## Decisions taken

| Decision | Outcome |
|---|---|
| Order of work | Two tracks in parallel after phase 0 |
| Network keys on desktop | Users bring their own, entered in the app |
| Settings design | The macOS System Settings style everywhere; Channels moves into it |
| X | No API by default. A browser-session driver drives the real X web client in a webview. The API driver stays available as an option |
| Upstream fixes | Made at the source (Stacks, stx, ts-css, Craft and others), released, then picked up here by a version bump |
| Tracking | Every item is a GitHub issue; one epic per phase |

## Still needed from you

| # | Need | Blocks |
|---|---|---|
| D3 | Apple Developer ID certificate and notarization credentials on the release runner | Phase 7 |
| D4 | A host and a domain for the marketing site and the update feed. `postline.stacksjs.com` redirects to theopentimes.org today | Phases 8 and 9 |
| D6 | A go-ahead before each push to an upstream `main`. I work in separate worktrees because those checkouts are on other agents' branches | Upstream items |

## Where it stands today

Solid, and kept: lint and type check are clean; the session cookie is httpOnly
and SameSite=Lax; login and register are rate limited; media serving is safe
against traversal and inline execution; purge has a real preview, typed
confirmation and audit rows; desktop data is outside the bundle at mode 0600;
SQLite runs in WAL with sensible pragmas; CI installs from a frozen lockfile and
every bundled licence is permissive; campaign timezone and DST maths are sound;
Bluesky rich text is built correctly; most views are already signal-based stx;
dark mode and the accessibility skeleton hold up **(seen)**.

Not ready:

| Area | State |
|---|---|
| Security | Several findings tracked privately until fixed; debug output on by default; open CORS |
| Publishing | Can double-post, can strand a post forever, never retries a failed network |
| Networks | LinkedIn pinned to a retired API version; X missing scopes and billed per read; threads chain on Bluesky only; counts wrong on every network; Blog "View live" has no page |
| Public claims | Six statements on the site are false today, and there is no way to download the app |
| Desktop | Not notarized; four of six networks unconfigurable; the first table-rebuild migration will stop every install from launching |
| Frontend | Two large hand-rolled DOM scripts, eight scripts on every page, three styling systems, raw TypeScript shipped by the production build **(seen)** |
| Operations | Uploaded media is wiped on every deploy and invisible to the scheduler; no backups off the box; no export; nothing tells the owner a post failed |
| Legal | An Apple font and third-party logos are tracked in a public repo; `SECURITY.md` is another project's; no privacy policy |

## Phases

```text
0 Ground ─┬─ 1 Security ─ 2 Engine ─ 3 Networks ─┬─ 7 Mac app ─┐
          │                                      └─ 8 Operations ─┤
          └─ 4 Design system ─ 5 Views ─ 6 Speed ─── 9 Site and docs ─┴─ 10 Launch
```

The backend track (1, 2, 3, 8) and the frontend track (4, 5, 6, 9) touch
different files and run side by side.

| Phase | Goal | Epic | Release |
|---|---|---|---|
| 0 Ground | Safe to change; only Postline in the repo | [stacksjs/postline#49](https://github.com/stacksjs/postline/issues/49) | 0.2 |
| 1 Security | No way in without a sign-in; secure as shipped | [stacksjs/postline#50](https://github.com/stacksjs/postline/issues/50) | 0.2 |
| 2 Engine | A post goes out once, and failures are visible and retryable | [stacksjs/postline#51](https://github.com/stacksjs/postline/issues/51) | 0.2 |
| 3 Networks | Each network behaves the way its platform does | [stacksjs/postline#52](https://github.com/stacksjs/postline/issues/52) | 0.3 |
| 4 Design system | One type scale, one colour system, one set of components | [stacksjs/postline#53](https://github.com/stacksjs/postline/issues/53) | 0.3 |
| 5 Views | Every view complete in every state | [stacksjs/postline#54](https://github.com/stacksjs/postline/issues/54) | 0.3 |
| 6 Speed | Budgets enforced on a production build | [stacksjs/postline#55](https://github.com/stacksjs/postline/issues/55) | 0.3 |
| 7 Mac app | Notarized, self-updating, survives upgrades | [stacksjs/postline#56](https://github.com/stacksjs/postline/issues/56) | 0.4 |
| 8 Operations | Hostable, observable, backed up | [stacksjs/postline#57](https://github.com/stacksjs/postline/issues/57) | 1.0 |
| 9 Site and docs | True claims, a download path, real documentation | [stacksjs/postline#58](https://github.com/stacksjs/postline/issues/58) | 1.0 |
| 10 Launch | Gated releases and a final audit | [stacksjs/postline#59](https://github.com/stacksjs/postline/issues/59) | 1.0 |
| Upstream | Fixes that belong in other repos | [stacksjs/postline#61](https://github.com/stacksjs/postline/issues/61) | as needed |
| Later | Product depth after 1.0 | [stacksjs/postline#60](https://github.com/stacksjs/postline/issues/60) | after 1.0 |

### Phase 0: Ground

Give the tests a throwaway database (they write into real data today), fix
first-run seeding, delete the starter (about 4,300 lines of code, 5 MB of assets,
190 inherited docs pages, eleven config files, the realtime service and Redis),
remove the unlicensed font and stock images, upgrade and unpin dependencies,
widen type checking to the client scripts, and make CI build the app, check the
desktop bundle, pin the list of public routes and open every view in a browser.

**Done when:** a fresh clone runs bootstrap, migrate, seed, dev and test with no
errors and without touching an existing database.

### Phase 1: Security

Close the findings that are tracked privately as draft security advisories
until they are fixed (four on this repository, two on Stacks). Then: CSRF on
cookie sessions, tokens encrypted at rest,
guarded outbound fetches and uploads, debug output off by default, one error
shape with no raw exception text, CORS limited to the app's own origin, rate
limits and a body cap on the remaining endpoints, security headers and a CSP on
pages, and query logging off.

The Open Times shares this code and is live; the fixes that apply are tracked
in that repository.

**Done when:** the route-table test lists the intended public routes and nothing
else, and each finding has a test that failed before the fix.

### Phase 2: Engine

Claim a post atomically so it publishes once. Recover posts stranded mid-publish.
Track the outcome per network, keep media until every network is settled, and
allow retrying the ones that failed. Honour rate limits. Stop a thread at its
first failure. Hold posts that are more than a grace window late. Give accounts
an explicit default. Make purge and retention safe by default. Log, surface
failures in an Activity view, and tell the owner when a post fails or a token
expires. Move uploaded media out of the release tree. Cover all of it with tests
on fake drivers, including the races.

**Done when:** 50 concurrent publish attempts send one post; killing the process
mid-publish leaves a recoverable post; one failed network can be retried alone.

### Phase 3: Networks

**X by browser session.** Postline opens its own webview on X with a persistent,
isolated profile; the owner signs in there. Writes drive the real compose UI, so
the client builds its own requests. Reads navigate to the page that shows the
data and capture the responses the page fetches for itself. Postline never
constructs an X request, stores no X password or token, and never tries to solve
a challenge: on a CAPTCHA or lock screen it stops and asks the owner. X's terms
prohibit automating the site outside the API, so the account can be challenged
or suspended; the driver is labelled accordingly and the API driver stays as an
option. A short spike comes first to prove four things about `Bun.WebView`:
a profile that survives restarts, setting a file input, capturing responses, and
running hidden.

**The rest.** Move LinkedIn off its retired API version. Count characters the
way each network does. Chain threads on every network that supports replies.
Support several images with alt text and reject media a network cannot take
before publishing, not after. Fix the Instagram and Threads public-URL
requirement, token keepalive, and the Instagram inbox. Sync engagement for every
network or say it is Bluesky-only. Give the blog a public page. Fix AI drafting
on its default provider.

**Done when:** each network has a contract test for publish, thread, image,
delete and an expired token, and the claims in phase 9 match.

### Phase 4: Design system

Self-host Geist and actually apply it; today every layout downloads it from
Google while the shell renders in the system font **(seen)**. One type scale and
three weights. One accent, status colours as tokens, dark mode from token values.
Fix contrast on muted text, input borders, the focus ring and placeholders. Build
each repeated pattern once as an stx component on `@stacksjs/components`, and
improve that package where it falls short.

**Done when:** no raw palette utility or arbitrary font size remains in app
views and the `!important` dark layer is gone.

### Phase 5: Views

Every view gets loading, empty and error states, busy buttons, undo or
confirmation on destructive actions, an unsaved-changes guard, keyboard access
and inline validation. The composer is rewritten on signals with live
per-network previews beside it, one publish control, and a real schedule picker.
Channels gains in-app credentials with a guide per network. Settings becomes one
macOS-style window that also holds Channels, profile, sessions, data and
updates. The queue's broken calendar link is fixed **(seen)**. A first-run flow
replaces the bare registration form.

**Done when:** the view-by-state table has no gaps and the smoke test passes at
375 px with no horizontal scroll.

### Phase 6: Speed

Measured on a production build **(seen)**: client scripts ship as raw
TypeScript, the stx runtime is unminified (251 KB, 64 KB gzipped), each page has
its own 60 to 80 KB stylesheet, and the settings page is 644 KB. Load code where
it is used, bundle and minify, share one stylesheet, cache one bootstrap
request, pause polling when hidden, and enforce budgets in CI.

**Done when:** budgets pass in CI: script under 150 KB gzipped for an app page,
CSS under 30 KB, fonts under 60 KB, no third-party requests.

### Phase 7: Mac app

Fix the upgrade migrator before any model change ships. Sign with a Developer
ID, notarize and staple. Loopback OAuth with in-app credentials. A signed update
feed. A backup that is safe for a WAL database. A menu-bar mode that keeps the
scheduler alive, which the X browser session also depends on. Jobs that run when
overdue at launch. Native notifications. Keep the marketing home and waitlist
out of the app.

**Done when:** a downloaded DMG opens with no warning on a clean Mac, upgrades
from v0.1.1 with data intact, updates itself, and connects all six networks.

### Phase 8: Operations

Blocked on D4; no deploy job is added before Postline has its own host. Then:
its own host, ports and domain; TLS, health gate, zero-downtime release and
rollback from the framework; backups that leave the box; a workspace export;
health that includes the scheduler; log and table retention; a complete and
secure `.env.example`.

**Done when:** a fresh server reaches a healthy Postline from the guide alone
and a restore has been rehearsed.

### Phase 9: Site and docs

Correct the six false claims. Add a download path and an install page; every
"Get started" link goes to the sign-in page today. Fix the waitlist (it claims a
confirmation step it does not have, and its email describes a framework). Keep
the marketing home and waitlist out of self-hosted installs. Add a privacy
policy and a statement of what leaves the machine. Write the user docs, of which
most pages do not exist.

**Done when:** every factual statement on the site has a line of code or a test
behind it, and a new user can install and connect a network from the docs alone.

### Phase 10: Launch

A release cannot be tagged unless CI passed on that commit. A scoped release
token and signed checksums. A final security audit and code review. Upgrade
notes from v0.1.x.

## How the issues are organised

- **Milestones:** `0.2 Safe and reliable`, `0.3 Complete and fast`,
  `0.4 Mac app`, `1.0`.
- **Labels:** `priority:blocker`, `priority:high`, `priority:normal`; one
  `area:` label; `size:S`, `size:M`, `size:L`; `epic` on the eleven phase
  issues. The existing `phase:12` label belongs to another scheme and is left
  alone.
- **Existing issues are reused, not duplicated:** #46 (plaintext tokens), #44
  (dead `DriverRegistry`), #18 (image upload), #47 (media scanning), #40, #39
  and #38 fold into the network, AI and purge issues. #41 and #42 belong to The
  Open Times.
- **Security findings with a direct exploit path are not public issues.** The
  repo is public and v0.1.1 is released, so five are draft security advisories
  on this repository, two are draft advisories on `stacksjs/stacks`, and one is
  an issue on the private Open Times repository. Publish each advisory when its
  fix ships.
- **Upstream issues** are filed in their own repositories (Stacks, stx, ts-css,
  Craft, ts-medium-editor, ts-charts, ReviewOS) and listed in the upstream epic.
