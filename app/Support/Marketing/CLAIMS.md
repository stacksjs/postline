# What the site says, and the code that makes it true

Every factual statement on the marketing site (`resources/views/index.stx`,
`resources/views/features/`, `resources/views/use-cases/`, this folder's
`catalog.ts`) and in the README is listed here with the code or test behind
it. Change a sentence on the site and this list in the same commit. A claim
that a phase still has to earn stays off the site until its issue closes.

Last checked 24 November 2026.

## Publishing

| Claim | Evidence |
|---|---|
| One draft to Bluesky, X, LinkedIn, Instagram, Threads and Mastodon | `app/Services/Social/*Service.ts`, `app/Services/Social/CrosspostService.ts` |
| Several accounts per network | `app/Services/Social/identities.ts`, `SocialIdentity.isDefault` |
| Threads chain where the network supports replies | `app/Support/Social/threads.ts:17`, `TwitterService.ts:246`, `MastodonService.ts`, `ThreadsService.ts` |
| Each network's character limit is counted | `app/Support/Social/count-text.ts`, `tests/unit/count-text.test.ts` |
| Instagram needs an image; the hero draft carries one | `InstagramService.ts:112` (`requiresMedia`), `index.stx` hero attachment |
| Rate limits and short outages retried, up to five times; other failures wait | `app/Support/Social/retry.ts:23`, `tests/unit/retry.test.ts` |
| A rejected post keeps the network's own error | `app/Support/Social/network-errors.ts` |
| Scheduled posts go out while Postline is running | `app/Desktop/schedule.ts`, `docs/desktop.md` |

## Accounts and keys

| Claim | Evidence |
|---|---|
| Bluesky and Mastodon connect directly; X, LinkedIn, Instagram and Threads need your own developer app | `app/Services/NetworkAppService.ts`, Channels "Your network apps" |
| Access and refresh tokens stored encrypted with a key your instance generates | `app/Support/Social/token-vault.ts:18` (`enc:v1:`) |
| Disconnecting deletes the tokens from Postline (not at the network) | `app/Services/Social/identities.ts:224-241` |
| History survives an account going away | `identities.ts:12` (revoked rows are kept) |
| History is a SQLite file you can query and copy, and the workspace exports to one file another install imports | `config/database.ts`, `app/Services/WorkspaceArchiveService.ts`, `tests/unit/workspace-archive.test.ts` |
| Instagram and Threads images need a public address, or temporary image links | `app/Support/Social/uploads.ts:112`, `media-share.ts`, `Account.shareMediaByTunnel` |
| Runs wherever Bun 1.3 and SQLite 3.47 do | README requirements, `deps.yaml` |

## Inbox, listening, analytics

| Claim | Evidence |
|---|---|
| Direct messages from Bluesky (app password with message access) and Mastodon | `app/Support/Social/direct-messages.ts` (`DM_PROVIDERS`), `app/Services/Social/DirectMessages/*.ts` |
| Instagram messages not supported (Meta app review) | `direct-messages.ts` (`DM_UNAVAILABLE.instagram`) |
| Direct messages from X through an opted-in developer app, with a daily read cap | `app/Services/Social/TwitterDmInbox.ts`, `docs/networks/x.md` |
| Keyword listening on Bluesky, X, Mastodon, every five minutes, up to 20 keywords | `app/Jobs/ScanKeywordMonitors.ts:13`, `KeywordMonitoringService.ts:48` |
| Engagement synced for Bluesky posts only | `app/Jobs/SyncEngagementMetrics.ts:17` |
| Thirty days of activity, channel mix, posting windows | `app/Actions/Postline/AnalyticsAction.ts` |
| Campaign plans from OpenAI, Anthropic, Ollama, or the built-in planner | `config/ai.ts`, `app/Services/CampaignAIService.ts` |
| Cleanup previews before deleting, daily retention, audit log | `app/Services/Social/PurgeService.ts`, `app/Jobs/AutoDeletePosts.ts` |

## Not on the site until they are true

- Engagement for X, LinkedIn, Instagram, Threads and Mastodon.
- Instagram direct messages and X direct messages through a browser session.
- Revoking a token at the network on disconnect.
- Team seats.
