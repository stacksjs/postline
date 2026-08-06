# Plan: Per-network content variants

> Office hours design + architecture review. Design only, no code.
> Verified against the code on 2026-07-30. **Decision 2 was reversed by the
> review — see "Correction" below.**

## Problem

The Open Times sends one body to every network. `CrosspostService.publishExisting`
(`:184`) loops providers and hands each the identical `post.body`. No variant
support exists anywhere.

The composer turns that limitation into an active penalty.
`resources/views/index.stx:187-194`:

```js
const limits = selectedConnected().map(p => p.characterLimit).filter(Boolean)
return limits.length ? Math.min(...limits) : 300
// ...
textareaFor(post)?.setAttribute('maxlength', String(limit))
```

It takes the **minimum** limit across selected networks and applies it as a hard
`maxlength`. Real limits in the codebase:

| Network | Limit | Source |
| --- | --- | --- |
| Twitter | 280 | `TwitterDriver.ts:80` |
| Bluesky | 300 | `socials/drivers/bluesky.ts:109` |
| Mastodon | 500 | `MastodonDriver.ts:64` |
| Threads | 500 | `socials/drivers/threads.ts:68` |
| Instagram | 2200 | `socials/drivers/instagram.ts:65` |
| LinkedIn | 3000 | `socials/drivers/linkedin.ts:69` |
| Blog | long-form | `BlogService.ts:54` |

**Select LinkedIn alone → 3000 characters. Tick Bluesky as well → hard-capped at
300, on LinkedIn too.** Adding a network makes the post worse everywhere, and
because it is `maxlength` the textarea simply stops accepting keystrokes. It
reads as a broken input, not a design decision.

This contradicts the landing thesis at `welcome.stx:193` — "Post once. Own
everything." Today it behaves closer to *post once, at Twitter's length*.

---

## Correction: where variants can actually live

The original design proposed storing overrides in a new `post_targets.content`
column, on the reasoning that `post_targets` already holds one row per provider
per post. **That is wrong, and the review caught it.** `post_targets` rows have
two lifecycles, and neither can carry a pre-publish override:

1. **Immediate publish** — each provider service inserts its own row *during*
   publish (`BlueskyService.ts:219`, `LinkedInService.ts:185`,
   `InstagramService.ts:199`, …) with status `publishing`. The row is a **record
   of the result**; it does not exist when the content decision is made.

2. **Queued publish** — `QueueService.save` does create rows up front (`:149`),
   but `publishAt` deletes them immediately before publishing
   (`QueueService.ts:335-339`):

   ```js
   // The provider services insert fresh result rows; drop the placeholders
   // so the queue doesn't show both.
   for (const target of placeholders)
     await database.deleteFrom('post_targets').where('id', '=', target.id).execute()
   ```

So a `post_targets.content` column would be **deleted at the exact moment it is
needed**. `post_targets` is a results ledger, not post state.

The option originally rejected — `posts.content` — is the correct one, and the
stated objection to it was also wrong. The claim was "publishing one target
rewrites a blob shared with every other target." Verified false: `posts.content`
is written only at save (`:133`) and update (`:293`), never during publish.
`removeStoredMedia` (`:401`) only unlinks files; it does not touch the column.

`posts.content` is right for reasons beyond elimination:

- It already survives the full lifecycle for both paths.
- `hydrateContent()` (`:362`) already rebuilds `PublishContent` from it at
  publish time, so the read path exists.
- It already carries exactly this class of data (title, link card, media refs).
- **It needs no migration.** The column exists (migration `0000000031`).

Net effect of the correction: one fewer migration, one fewer concept, and a
storage location whose read path is already written.

---

## Scope assessment: **RIGHT-SIZED**, with one addition and one deferral

### Expansion analysis

| Addition | Core to goal? | Ship separately? | Risk if included |
| --- | --- | --- | --- |
| Advisory counters (drop `maxlength`) | Yes | **Yes** | None — strictly removes a restriction |
| Per-provider override resolution | Yes | No | Low — one function, no driver changes |
| Persistence through save/update | Yes | No | Medium — three call sites must agree |
| Composer fork UI | Yes | No | Medium — largest surface, needs browser QA |
| Thread-splitting on overflow | **No** | Yes | Auto-split prose quality; defer |
| POSSE / canonical long-form | **No** | Yes | Whole separate product direction |

### Reduction analysis

| Missing piece | Needed for v1? | Cost of deferring |
| --- | --- | --- |
| Variants survive queue **editing** | **Yes** | `QueueUpdateAction` rewrites `posts.content` (`:293`); a variant silently vanishes when a queued post is edited |
| Fork staleness indicator | Yes | Editing the shared body after forking publishes stale copy with no warning |
| Per-target server rejection | No — exists | Services already return `{ok:false, error}` per target (`BlueskyService.ts:178`) |
| Per-network media variants | No | Text-only is a coherent v1 |

**The queue-edit path is the piece the design missed.** Any variant work must
thread through `QueueUpdateAction` or it regresses on the first edit.

**Recommended scope:** advisory counters → resolution seam → persistence
(save + update + hydrate) → composer UI. Thread-splitting and POSSE out.

## Data flow

```
IMMEDIATE ─ composer
  → CrosspostPublishAction        builds PublishContent (+ variants)
  → CrosspostService.publish()    inserts posts row
  → publishExisting()             variants[provider] ?? post.body   ← THE SEAM
     └→ publisher.publishToPost({ id, body })   drivers unchanged

QUEUED ─ composer
  → QueueSaveAction / QueueUpdateAction
  → QueueService.save()/update()  persists posts.content (+ variants)
  → publishAt() → hydrateContent()  rebuilds PublishContent
  → publishExisting()             same seam, same resolution
```

Both paths converge on `publishExisting` (`CrosspostService.ts:179-192`), which
already loops providers and constructs `{ id, body }` per call. Resolving the
override there means **no driver changes at all** — that claim from the design
survives review.

**Error paths:** an override longer than its own network's limit fails only that
target (services already return per-target results); a malformed variants blob
is caught by `parseStoredContent`'s existing try/catch and degrades to the
shared body.

## Architecture review

- **Breaking changes:** none. `PublishContent.variants` and
  `StoredContent.variants` are both optional; absent means today's behaviour.
- **New dependencies:** none.
- **Migrations:** **none.** `posts.content` already exists.
- **Cross-package impact:** none. All changes in `app/` and `resources/views/`.
  No driver touched, so the vendored `socials` package is unaffected.
- **Consistency:** `variants` as an optional key on the existing content JSON
  matches how `title`, `external`, and `media` are already modelled
  (`StoredContent`, `QueueService.ts:13-18`).

### Interface changes

**`PublishContent`** (`app/Support/Social/types.ts:54`)
Add `variants?: Partial<Record<SocialProvider, string>>`. Optional, non-breaking.

**`StoredContent`** (`app/Services/Social/QueueService.ts:13`)
Same key, so `hydrateContent` can round-trip it.

**`CrosspostService.publishExisting`** (`:179`)
Signature unchanged. Body resolution changes internally.

## Test matrix

### Unit — P0

| Function | Case | Expected |
| --- | --- | --- |
| `publishExisting` | no variants | every provider gets `post.body` (regression guard) |
| `publishExisting` | variant for one provider | that provider gets it; others get shared body |
| `publishExisting` | variant is empty string | treated as inherit, not an empty post |
| `publishExisting` | variant for an unselected provider | ignored |
| `parseStoredContent` | malformed variants blob | degrades to shared body, no throw |
| `hydrateContent` | variants round-trip | survives save → hydrate unchanged |

### Integration — P0/P1

| Flow | Scenario | Priority |
| --- | --- | --- |
| Save → edit → publish | variant survives `QueueUpdateAction` | **P0** |
| Save → publish | queued variant reaches the right provider | P0 |
| Immediate publish | variant from request reaches the right provider | P0 |
| Partial failure | one target rejects an over-limit variant; others publish | P1 |

### Edge cases

| Case | Why it matters | Approach |
| --- | --- | --- |
| Fork, then edit shared body | Silent stale publish — the main UX risk | Mark stale in composer; unit-test the flag |
| Provider deselected after forking | Orphan override reappearing unexpectedly | Keep stored, surface on reselect |
| Override over its own limit | Must fail one target, not all | Integration test |
| Instagram without image | Unchanged requirement | Existing guard |
| Blog `title` vs variant body | Must not collide | Assert both persist |

## Implementation plan

### Phase 1 — advisory counters (independently shippable)
- [ ] Remove the `maxlength` write at `index.stx:194`.
- [ ] Keep `effectiveLimit()` for display; show per-network over/under state on
      the existing provider chips.
- [ ] Confirm server-side per-target limit errors surface in the results panel.

**Checkpoint:** a user can write 3000 characters with Bluesky selected; Bluesky
reports over-limit, LinkedIn publishes. No schema change, no new concepts.
**This phase is valuable even if variants are never built.**

### Phase 2 — resolution seam
- [ ] Add `variants?` to `PublishContent` (`types.ts:54`).
- [ ] Resolve in `publishExisting` (`CrosspostService.ts:184`):
      `content?.variants?.[provider] ?? post.body`.
- [ ] Unit tests (all six P0 cases above).

**Checkpoint:** `bun test` green; behaviour identical when no variants are passed.

### Phase 3 — persistence
- [ ] Add `variants?` to `StoredContent` (`QueueService.ts:13`).
- [ ] Persist in `save()` (`:133`) **and `update()` (`:293`)** — the second is
      the one the design missed.
- [ ] Rebuild in `hydrateContent()` (`:362`).
- [ ] Accept overrides in `QueueSaveAction`, `QueueUpdateAction`,
      `CrosspostPublishAction`.
- [ ] Integration tests, especially save → edit → publish.

**Checkpoint:** a variant survives a queue edit and reaches only its provider.

### Phase 4 — composer fork UI
- [ ] Per-network "customise" affordance; fork seeded from the shared draft.
- [ ] Visible forked state and a staleness indicator.
- [ ] Register any dynamically toggled classes in the existing Crosswind
      safelist block (`index.stx:11`).

**Checkpoint:** browser QA — **cannot be done in this environment**, requires
`buddy dev`.

### Rollback
Each phase reverts independently. Phases 2 and 3 are inert until Phase 4 sends
overrides; reverting Phase 4 alone restores current behaviour with the plumbing
dormant and harmless.

## Non-goals

- AI-generated or auto-rewritten per-network copy.
- Per-network media variants or per-network scheduling.
- Thread-splitting on overflow — real, but a separate change. Worth noting the
  machinery exists (`CrosspostService.publishThread`, and
  `CrosspostPublishAction` already accepts a `thread` array), so it is cheap
  later. It should be an explicit user action, never automatic.
- POSSE / canonical long-form — a positioning decision deserving its own session.

## Open questions

1. **Fork staleness:** mark stale with one-click re-sync (my recommendation),
   or silent divergence?
2. **Threads plus variants:** does an override replace segment one or the whole
   chain? Suggest deferring — keep threads on the shared body for v1.
3. **Is POSSE the real feature?** It fits "Own everything" better than overrides,
   and the `blog` provider already exists.

## Summary

- **Scope:** right-sized, once the queue-edit path is added.
- **Breaking changes:** none.
- **New dependencies:** none. **Migrations: none.**
- **Key risk:** silent staleness — a fork that quietly diverges from an edited
  shared body publishes the wrong text with no signal. Mitigated by the
  staleness indicator in Phase 4, which is therefore not optional polish.
- **Second risk:** Phase 3 touching three call sites that must agree; mitigated
  by the save → edit → publish integration test.
- **Verification caveat:** publishing cannot be exercised end to end without real
  credentials, and Phase 4 needs a browser pass this environment cannot run.
  Phases 1–3 are fully unit-testable.
