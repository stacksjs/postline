# Plan: Media upload — closing out issue #18

> Supersedes the scope in issue #18, which is stale. Design + architecture review.
> Verified against the code and `bun test` on 2026-07-29.

## Scope assessment: **TOO BROAD**

Issue #18 lists five work items for "real image upload". Four are already
implemented and covered by passing tests. The image pipeline is complete on
every driver:

| Driver | Image support | Implementation |
| --- | --- | --- |
| Bluesky | Complete | blob upload; fetches URL-only media server-side (`BlueskyService.ts:195`) |
| LinkedIn | Complete | three-step Images API (`Drivers/LinkedInDriver.ts:110-145, 183-220`) |
| Instagram | Complete | container → publish with `image_url` (`Drivers/InstagramDriver.ts`) |
| Threads | Complete | `media_type: IMAGE`, text-only fallback (`Drivers/ThreadsDriver.ts`) |

Supporting infrastructure, also already built:

- `MediaServeAction.ts` + `routes/api.ts:29` — unauthenticated, traversal-guarded
  `GET /postline/media?file=…` with UUID filenames and immutable cache headers.
- `Support/Social/uploads.ts` — `buildMediaUrl()`, `publicMediaUrl()`,
  `persistTempMedia()` / `removeTempMedia()`.
- `QueueService.ts:383` — attaches a public URL for scheduled posts.
- `tests/unit/{linkedin,instagram,threads}-driver.test.ts`, `media-serve.test.ts`,
  `social-publish.test.ts` — **42 tests, all passing.**

Two design questions the issue raises are already answered in code:

- **LinkedIn `article` vs `media` one-of conflict** — resolved at
  `LinkedInDriver.ts:213-228`: image wins, article is the `else` branch.
- **Temp-media deletion race** — reasoned through at
  `CrosspostPublishAction.ts:41-43`: Meta downloads during container creation,
  so the file is safe to delete in the `finally`. Correct for Instagram's
  two-call flow, since `media_publish` consumes the container, not the URL.
  Unverified against the live API.

### Reduction analysis — what is genuinely missing

| Missing piece | Needed for v1? | Cost of deferring |
| --- | --- | --- |
| Reachability check on the media base | **Yes** | Instagram/Threads fail opaquely on every default install |
| Docs for `STORAGE_PUBLIC_URL` | **Yes** | Self-hosters cannot diagnose the above |
| Test for the localhost case | Yes | The defect is reintroducible |
| Tunnel-aware media base (dev) | No | DX only; images still work in production |
| Object storage (S3/R2) | No | `STORAGE_PUBLIC_URL` already covers self-hosters |

**Recommended scope: one defect fix, plus docs and tests. Not a feature build.**

---

## The actual defect

`hasPublicMediaBase()` (`uploads.ts:83`) is a **presence** check, not a
**reachability** check:

```ts
return Boolean(String(env.STORAGE_PUBLIC_URL || env.APP_URL || '').trim())
```

`.env.example:4` ships `APP_URL=postline.localhost`. That is non-empty, so:

1. `persistTempMedia()` succeeds and writes the file.
2. `publicMediaUrl()` returns `https://postline.localhost/postline/media?file=…`.
3. `InstagramService`'s `!media?.url` guard **passes** — a URL exists.
4. Postline hands that URL to the Meta Graph API.
5. Meta tries to fetch `postline.localhost` **from its own servers** and fails.
6. The user gets an opaque Meta-side error about an inaccessible image.

Instagram cannot post without an image, so on a default local install
**Instagram fails 100% of the time with an error that points at Meta rather
than at the misconfigured `APP_URL`.** Threads degrades to text-only.

No guard exists anywhere in `app/Support/Social/` or `app/Services/Social/`
(grepped for `localhost`, `127.0.0.1`, `isPublic`, `reachab` — only a prose
comment). No test covers it: `media-serve.test.ts` tests empty bases and unsafe
filenames, never a non-public host.

### Why this was missed

The design doc's first draft (and issue #18) both assumed the *drivers* were the
gap. They aren't. The gap is a config-validation seam between a correct upload
pipeline and a platform requirement that only bites in production-like
conditions — invisible to unit tests, invisible locally until you connect a real
Meta account.

---

## Decision — how to close the reachability gap

**Minimal** — classify the base URL and fail fast with an accurate message.
Add `isPubliclyReachableBase(url)` next to `hasPublicMediaBase()`: reject
`localhost`, `*.localhost`, `127.0.0.0/8`, `::1`, `*.local`, `*.internal`, and
private ranges (`10.`, `192.168.`, `172.16–31.`). When it fails, Instagram and
Threads return a message naming the real cause and the fix.
- Pros: ~2h. Turns a confusing platform error into an actionable one. Pure
  function, trivially unit-testable, no new dependency, no infra.
- Cons: does not make images work locally.
- **Recommended.**

**Ideal** — active preflight: `HEAD` the media URL from the server before
publishing.
- Pros: catches genuine cases a string check misses (public DNS that is
  firewalled, a tunnel that just died).
- Cons: a server reaching *itself* proves nothing about Meta reaching it, so it
  gives false confidence in exactly the case that matters. Adds latency and a
  failure mode to every publish.
- Rejected: higher cost, weaker guarantee.

**Creative** — tunnel-aware media base. Stacks ships `buddy tunnel`; detect an
active tunnel and prefer its public hostname automatically.
- Pros: makes Instagram/Threads images work in local dev with no cloud account.
  Best DX-per-hour item remaining.
- Cons: dev-only, ephemeral URLs, needs a fallback. Strictly additive to Minimal.
- Recommended as a **follow-up**, not part of this change.

---

## Data flow

```
composer (multipart)
  → CrosspostPublishAction.ts:39   readUploadedImage()
  → uploads.ts:94                  persistTempMedia()      ← reachability gate belongs here
  → CrosspostService.publish()
     ├→ LinkedInDriver   uses media.bytes   → /rest/images  (no public URL needed)
     ├→ BlueskyDriver    uses media.bytes   → blob upload   (no public URL needed)
     ├→ InstagramDriver  uses media.url     → Meta fetches  ← fails on localhost
     └→ ThreadsDriver    uses media.url     → Meta fetches  ← degrades to text
  → finally: removeTempMedia()
```

The byte-upload providers are unaffected by this defect; only the two Meta
providers depend on outbound reachability.

## Architecture review

- **Breaking changes:** none. New exported function plus two error strings.
- **New dependencies:** none.
- **Cross-package impact:** none. All changes live in `app/`. Note the vendored
  `storage/framework/core/socials/src/drivers/linkedin.ts` has *no* media
  support, but it is unused — `DriverRegistry.ts:5` wires the app-level driver.
  Worth an upstream issue, out of scope here.
- **Consistency:** `isPubliclyReachableBase()` matches the existing pure-helper
  style in `uploads.ts` (`buildMediaUrl`, `isSafeMediaFilename`), which are
  already split out specifically to be testable without env.

## Test matrix

| # | Test | Input | Expected | Priority |
| --- | --- | --- | --- | --- |
| 1 | rejects localhost forms | `postline.localhost`, `localhost:3000`, `127.0.0.1` | `false` | P0 |
| 2 | rejects private ranges | `10.0.0.5`, `192.168.1.9`, `172.16.0.1` | `false` | P0 |
| 3 | rejects `.local` / `.internal` | `postline.local` | `false` | P0 |
| 4 | accepts real public hosts | `https://posts.example.com` | `true` | P0 |
| 5 | accepts scheme-less public host | `posts.example.com` | `true` | P0 |
| 6 | Instagram error names the cause | localhost base + image | error mentions `STORAGE_PUBLIC_URL` | P0 |
| 7 | Threads degrades to text-only | localhost base + image | text posts, image skipped, note surfaced | P1 |
| 8 | LinkedIn unaffected | localhost base + image bytes | image still uploads | P0 (regression guard) |
| 9 | Bluesky unaffected | localhost base + image bytes | blob still uploads | P0 (regression guard) |

Tests 8 and 9 matter most: they pin the fact that byte-upload providers must
**not** be gated by a reachability check.

## Implementation plan

### Phase 1 — reachability classification (P0)
- [ ] Add `isPubliclyReachableBase(base: string): boolean` to
      `app/Support/Social/uploads.ts`, beside `hasPublicMediaBase()`.
- [ ] Add `mediaBaseProblem(): string | null` returning a ready-to-surface
      explanation, so services don't duplicate copy.
- [ ] Unit tests 1–5 in `tests/unit/media-serve.test.ts`.

**Checkpoint:** `bun test tests/unit/media-serve.test.ts` green; no behaviour change yet.

### Phase 2 — honest errors on the Meta providers (P0)
- [ ] `InstagramService.publishToPost` (`:174`) — when media exists but the base
      is unreachable, return that specific cause instead of
      "Instagram requires an image — add an image URL."
- [ ] `ThreadsService.publishToPost` (`:172`) — drop the image, post text, and
      surface a note rather than failing the whole target.
- [ ] Tests 6–7.

**Checkpoint:** a localhost install explains itself; LinkedIn/Bluesky untouched.

### Phase 3 — regression guards + docs (P0/P1)
- [ ] Tests 8–9 pinning byte-upload providers as ungated.
- [ ] Document `STORAGE_PUBLIC_URL` in `.env.example` with a comment stating
      Meta fetches server-side and localhost cannot work.
- [ ] Rewrite issue #18 to reflect that the drivers are done.

**Checkpoint:** full `bun test` green; `bunx --bun pickier .` clean.

### Rollback
Each phase is independently revertable. Phase 1 is additive and dead until
Phase 2 calls it; reverting Phase 2 alone restores current behaviour exactly.

## Non-goals

- Video, multi-image carousels, backfilling media onto published posts.
- Object storage (S3/R2) — `STORAGE_PUBLIC_URL` already serves self-hosters.
- Fixing the vendored `socials` package driver (unused; upstream concern).

## Open questions

1. Threads on an unreachable base: post text-only with a note (proposed), or
   fail the target so the user knows the image was dropped?
2. Want the tunnel-aware media base as an immediate follow-up (~4h)?
3. Should issue #18 be rewritten, or closed and replaced with a narrow
   "media base reachability" issue?

## Summary

- **Scope:** too broad as written; 4/5 issue items are done and tested.
- **Breaking changes:** none.
- **New dependencies:** none.
- **Key risk:** over-gating. A reachability check must never block LinkedIn or
  Bluesky, which upload bytes and need no public URL. Mitigated by tests 8–9.
- **Verification caveat:** with an empty `.env` none of this can be exercised
  against a live Meta API. The fix is a pure function plus error copy, fully
  unit-testable, but confirming the *original* Meta failure needs real credentials.
