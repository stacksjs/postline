# Changelog

## v0.1.1

[Compare changes](https://github.com/stacksjs/postline/compare/v0.1.0...v0.1.1)

## 🐛 Bug Fixes

- **ci**: build the release without a signing identity when none is set ([a398d76](https://github.com/stacksjs/postline/commit/a398d76)) _(by Chris)_
- **ci**: name the fetched Craft runtime in the release build ([3dad6f1](https://github.com/stacksjs/postline/commit/3dad6f1)) _(by Chris)_

## 🔧 Chores

- upgrade to Stacks 0.75.606 and drop the Craft runtime workaround ([e294175](https://github.com/stacksjs/postline/commit/e294175)) _(by Chris)_

## Contributors

- _Chris_

## v0.1.0

## 💥 Breaking Changes

- feat!: remove the publication product ([04cd09d](https://github.com/stacksjs/postline/commit/04cd09d)) _(by Chris)_

## ✨ Features

- **desktop**: self-contained Mac app with a native Settings window ([f7cb53b](https://github.com/stacksjs/postline/commit/f7cb53b)) _(by Chris)_
- **desktop**: bundle the app's routes and actions for a self-contained app ([950f086](https://github.com/stacksjs/postline/commit/950f086)) _(by Chris)_
- **release**: publish the desktop release through Pantry, and write the README ([67c8f86](https://github.com/stacksjs/postline/commit/67c8f86)) _(by Chris)_
- **site**: a modern identity and a new marketing site for Postline ([6dc7f1c](https://github.com/stacksjs/postline/commit/6dc7f1c)) _(by Chris)_
- **seeders**: add an application seeder structure, starting with a usable workspace ([9984171](https://github.com/stacksjs/postline/commit/9984171)) _(by glennmichael123)_ ([stacksjs/postline#42](https://github.com/stacksjs/postline/issues/42))
- **accounts**: connect several accounts per network, and cross-post to any of them ([d07b505](https://github.com/stacksjs/postline/commit/d07b505)) _(by Chris)_
- **settings**: delete posts automatically once they are N days old ([896ca21](https://github.com/stacksjs/postline/commit/896ca21)) _(by Chris)_
- **desktop**: ship a usable macOS app, with a DMG on every release ([f56d0d2](https://github.com/stacksjs/postline/commit/f56d0d2)) _(by Chris)_
- **cloud**: declare mail DNS so deploys reconcile it ([d38ec96](https://github.com/stacksjs/postline/commit/d38ec96)) _(by Chris Breuer)_
- **realtime**: make broadcasting actually reach readers ([6013721](https://github.com/stacksjs/postline/commit/6013721)) _(by Chris Breuer)_
- **composer**: rich text for long-form, on ts-medium-editor ([a45eb64](https://github.com/stacksjs/postline/commit/a45eb64)) _(by Chris Breuer)_
- **purge**: let the purge tool clear your own Discover feed ([2b33aa5](https://github.com/stacksjs/postline/commit/2b33aa5)) _(by Chris Breuer)_
- **read**: add the public reading surface ([822c46a](https://github.com/stacksjs/postline/commit/822c46a)) _(by Chris Breuer)_
- **publication**: add the management surface ([592c7a5](https://github.com/stacksjs/postline/commit/592c7a5)) _(by Chris Breuer)_
- **import**: bring a publication over from elsewhere ([f364a33](https://github.com/stacksjs/postline/commit/f364a33)) _(by Chris Breuer)_
- **comments**: keep the conversation with the post ([3be0dde](https://github.com/stacksjs/postline/commit/3be0dde)) _(by Chris Breuer)_
- **newsletter**: send every post to its readers ([595b707](https://github.com/stacksjs/postline/commit/595b707)) _(by Chris Breuer)_
- **billing**: add paid subscriptions ([50f2bbb](https://github.com/stacksjs/postline/commit/50f2bbb)) _(by Chris Breuer)_
- **discover**: build the Discover network ([51b90d7](https://github.com/stacksjs/postline/commit/51b90d7)) _(by Chris Breuer)_
- **marketing**: reframe the site around publishing ([32dc3dd](https://github.com/stacksjs/postline/commit/32dc3dd)) _(by Chris Breuer)_
- **inbox**: add Instagram DM support ([21ab44d](https://github.com/stacksjs/postline/commit/21ab44d)) _(by Chris Breuer)_
- **inbox**: read and reply to DMs across networks ([e1c496b](https://github.com/stacksjs/postline/commit/e1c496b)) _(by Chris Breuer)_
- **campaigns**: add Stacks launch playbook ([86a7b92](https://github.com/stacksjs/postline/commit/86a7b92)) _(by Chris Breuer)_
- **campaigns**: add AI builder assistant UI ([0fc6e7c](https://github.com/stacksjs/postline/commit/0fc6e7c)) _(by Chris)_
- **ai**: add campaign assistant service ([981a119](https://github.com/stacksjs/postline/commit/981a119)) _(by Chris)_
- **listening**: add keyword mention monitoring ([c7570c3](https://github.com/stacksjs/postline/commit/c7570c3)) _(by Chris)_
- **blog**: add long-form publishing workspace ([e5ba0af](https://github.com/stacksjs/postline/commit/e5ba0af)) _(by Chris)_
- **dev**: open Postline in a native window ([dcfbfee](https://github.com/stacksjs/postline/commit/dcfbfee)) _(by Chris)_
- **marketing**: lead with open source, add email capture, fix brand icons ([52eba42](https://github.com/stacksjs/postline/commit/52eba42)) _(by Chris)_
- **marketing**: feature and use-case pages behind a mega menu ([1a4239a](https://github.com/stacksjs/postline/commit/1a4239a)) _(by Chris)_
- **cloud**: deploy Postline as a tenant on the shared stacks box ([02b8ba9](https://github.com/stacksjs/postline/commit/02b8ba9)) _(by Chris)_
- **marketing**: componentize the landing page and fix its social metadata ([c6ec72a](https://github.com/stacksjs/postline/commit/c6ec72a)) _(by Chris)_
- **social**: add LinkedIn to bulk post deletion ([e925476](https://github.com/stacksjs/postline/commit/e925476)) _(by Chris)_
- **ui**: add danger zone bulk post deletion to accounts ([32667b9](https://github.com/stacksjs/postline/commit/32667b9)) _(by Chris)_
- **api**: expose purge preview and run endpoints ([1bec439](https://github.com/stacksjs/postline/commit/1bec439)) _(by Chris)_
- **social**: add PurgeService for bulk post deletion ([6941b8f](https://github.com/stacksjs/postline/commit/6941b8f)) _(by Chris)_
- **social**: add purge_runs audit table ([a94b3b4](https://github.com/stacksjs/postline/commit/a94b3b4)) _(by Chris)_
- **social**: add remote delete and own-post enumeration to drivers ([812becf](https://github.com/stacksjs/postline/commit/812becf)) _(by Chris)_
- per-network content variants for crossposting ([544c453](https://github.com/stacksjs/postline/commit/544c453)) _(by glennmichael123)_
- landing page sections 2–6 + scroll motion (Phases 2–7) ([081f52e](https://github.com/stacksjs/postline/commit/081f52e)) _(by glennmichael123)_
- add X/Twitter crossposting (OAuth2 PKCE, tweets, media, threads) ([5b1fab3](https://github.com/stacksjs/postline/commit/5b1fab3)) _(by glennmichael123)_
- serve post images publicly so Instagram/Threads can fetch uploaded files ([a273749](https://github.com/stacksjs/postline/commit/a273749)) _(by glennmichael123)_ ([#18](https://github.com/stacksjs/postline/issues/18))
- proactively refresh expiring OAuth tokens for Threads, LinkedIn, Instagram ([4916d28](https://github.com/stacksjs/postline/commit/4916d28)) _(by glennmichael123)_ ([#19](https://github.com/stacksjs/postline/issues/19), [#18](https://github.com/stacksjs/postline/issues/18))
- add LinkedIn image upload to the crosspost driver ([575d09e](https://github.com/stacksjs/postline/commit/575d09e)) _(by glennmichael123)_ ([#18](https://github.com/stacksjs/postline/issues/18))
- dark mode ([ea6ecf1](https://github.com/stacksjs/postline/commit/ea6ecf1)) _(by glennmichael123)_
- Mastodon crosspost driver ([030169d](https://github.com/stacksjs/postline/commit/030169d)) _(by glennmichael123)_
- actionable Bluesky publish errors + refresh-failure handling (#17) ([e771e1b](https://github.com/stacksjs/postline/commit/e771e1b)) _(by glennmichael123)_ ([#17](https://github.com/stacksjs/postline/issues/17))
- calendar view for the queue (#20) ([36baa1b](https://github.com/stacksjs/postline/commit/36baa1b)) _(by glennmichael123)_ ([#20](https://github.com/stacksjs/postline/issues/20))
- edit queued and scheduled posts (#21) ([3b4e3f8](https://github.com/stacksjs/postline/commit/3b4e3f8)) _(by glennmichael123)_ ([#21](https://github.com/stacksjs/postline/issues/21))
- queued posts carry title, link card, and image to publish ([aaace84](https://github.com/stacksjs/postline/commit/aaace84)) _(by glennmichael123)_

## 🐛 Bug Fixes

- **ci**: pin the Pantry action to its commit, not its tag object ([cd76f89](https://github.com/stacksjs/postline/commit/cd76f89)) _(by Chris)_
- **ci**: test against the database the app runs on ([7d96aae](https://github.com/stacksjs/postline/commit/7d96aae)) _(by Chris)_
- **ui**: show which chips and toggles are selected ([59307e1](https://github.com/stacksjs/postline/commit/59307e1)) _(by Chris)_
- **test**: boot auto-imports in tests ([cbcc3a0](https://github.com/stacksjs/postline/commit/cbcc3a0)) _(by Chris)_
- **settings**: the channels card covers every channel, not just Bluesky ([5cf962e](https://github.com/stacksjs/postline/commit/5cf962e)) _(by glennmichael123)_
- **seeder**: a seeded social identity is not connected ([39f21bb](https://github.com/stacksjs/postline/commit/39f21bb)) _(by glennmichael123)_
- **desktop,composer**: let Craft draw the window controls, and stop narrating ([d06bcfe](https://github.com/stacksjs/postline/commit/d06bcfe)) _(by glennmichael123)_
- **desktop**: open the workspace, and stop calling the app craft-runtime ([8e9e5af](https://github.com/stacksjs/postline/commit/8e9e5af)) _(by glennmichael123)_
- **auth**: honour the session cookie, so a browser can sign in ([b98b84f](https://github.com/stacksjs/postline/commit/b98b84f)) _(by glennmichael123)_ ([#45](https://github.com/stacksjs/postline/issues/45))
- **analytics**: guard an incomplete payload, and add the feature suite ([4abfe34](https://github.com/stacksjs/postline/commit/4abfe34)) _(by glennmichael123)_ ([stacksjs/stx#1933](https://github.com/stacksjs/stx/issues/1933))
- **accounts,env**: restore the Mastodon scope fix and the Twitter redirect host ([8bee97a](https://github.com/stacksjs/postline/commit/8bee97a)) _(by glennmichael123)_
- **newsletter**: a suppressed recipient is skipped, not failed ([a17d9a2](https://github.com/stacksjs/postline/commit/a17d9a2)) _(by glennmichael123)_
- **env**: empty mail credentials, not the string "null" ([3a599c5](https://github.com/stacksjs/postline/commit/3a599c5)) _(by glennmichael123)_
- **newsletter**: a failed send is no longer recorded as delivered ([5200710](https://github.com/stacksjs/postline/commit/5200710)) _(by glennmichael123)_
- **marketing**: give the layout the <main> the router swaps into ([b07d865](https://github.com/stacksjs/postline/commit/b07d865)) _(by glennmichael123)_ ([stacksjs/stx#1853](https://github.com/stacksjs/stx/issues/1853))
- **deploy**: pass 0.75's API-reachability check, and let any AI key pick the provider ([3030436](https://github.com/stacksjs/postline/commit/3030436)) _(by Chris)_
- **release**: stop release:patch building library packages this app doesn't ship ([9376fb6](https://github.com/stacksjs/postline/commit/9376fb6)) _(by Chris)_
- **campaigns**: let the planner use the feed and the blog ([7f7d88f](https://github.com/stacksjs/postline/commit/7f7d88f)) _(by Chris)_
- **settings**: quieter scheduled deletion, and a dark-mode consent box ([2f4c18f](https://github.com/stacksjs/postline/commit/2f4c18f)) _(by Chris)_
- **campaigns**: schedule in the campaign's time zone, and let AI plans use any key ([2a9f742](https://github.com/stacksjs/postline/commit/2a9f742)) _(by Chris)_
- **database**: snapshot the models this app actually has ([caef991](https://github.com/stacksjs/postline/commit/caef991)) _(by Chris Breuer)_
- **deploy**: drop the one-shot --force, and size the limits to the release ([73d00db](https://github.com/stacksjs/postline/commit/73d00db)) _(by Chris Breuer)_
- **deploy**: force the pending migration through, once ([0032ea9](https://github.com/stacksjs/postline/commit/0032ea9)) _(by Chris Breuer)_
- **deploy**: stop shipping the encrypted env to a box that cannot read it ([5636384](https://github.com/stacksjs/postline/commit/5636384)) _(by Chris Breuer)_
- **ci**: move off the Bun that segfaults on our preload ([67d3dad](https://github.com/stacksjs/postline/commit/67d3dad)) _(by Chris Breuer)_
- **ci**: type-check without a Bun runtime at all ([fd1e026](https://github.com/stacksjs/postline/commit/fd1e026)) _(by Chris Breuer)_
- **ci**: run tsc's native binary instead of crashing Bun on it ([2d49467](https://github.com/stacksjs/postline/commit/2d49467)) _(by Chris Breuer)_
- **typecheck**: cover config/ and routes/, and fix what that surfaced ([6f9c40a](https://github.com/stacksjs/postline/commit/6f9c40a)) _(by Chris Breuer)_
- **email**: declare DMARC where the deploy actually reads it ([a45e633](https://github.com/stacksjs/postline/commit/a45e633)) _(by Chris Breuer)_
- **email**: send from a zone we actually administer ([a9f0e19](https://github.com/stacksjs/postline/commit/a9f0e19)) _(by Chris Breuer)_
- **domains**: 301 the legacy postline host instead of serving it ([45b0c7a](https://github.com/stacksjs/postline/commit/45b0c7a)) _(by Chris Breuer)_
- **brand**: square the corners and fix the sign-in copy ([35e2fd9](https://github.com/stacksjs/postline/commit/35e2fd9)) _(by Chris Breuer)_
- **deps**: declare the packages we import directly ([978339a](https://github.com/stacksjs/postline/commit/978339a)) _(by Chris Breuer)_
- **subscribers**: actually send the confirmation email ([3162a8b](https://github.com/stacksjs/postline/commit/3162a8b)) _(by Chris Breuer)_
- **billing**: make Stripe actually work ([89f9bc0](https://github.com/stacksjs/postline/commit/89f9bc0)) _(by Chris Breuer)_
- **deploy**: skip production model generation ([ffdcc03](https://github.com/stacksjs/postline/commit/ffdcc03)) _(by Chris Breuer)_
- **deploy**: skip production database seeding ([11447d5](https://github.com/stacksjs/postline/commit/11447d5)) _(by Chris Breuer)_
- **buddy**: release inherited deploy lock ([5a45244](https://github.com/stacksjs/postline/commit/5a45244)) _(by Chris Breuer)_
- **deploy**: pass AI config to production API ([9159659](https://github.com/stacksjs/postline/commit/9159659)) _(by Chris Breuer)_
- **api**: expose production health status ([035759f](https://github.com/stacksjs/postline/commit/035759f)) _(by Chris Breuer)_
- **buddy**: close completed watchdog pipes ([006f6ab](https://github.com/stacksjs/postline/commit/006f6ab)) _(by Chris Breuer)_
- **ci**: use authorized deployment key ([8b59e0c](https://github.com/stacksjs/postline/commit/8b59e0c)) _(by Chris Breuer)_
- **ci**: provision deployment SSH key ([fedbc68](https://github.com/stacksjs/postline/commit/fedbc68)) _(by Chris Breuer)_
- **shell**: keep sidebar fixed and simplify navigation ([7687c4c](https://github.com/stacksjs/postline/commit/7687c4c)) _(by Chris)_
- **navigation**: make app tabs actionable and idempotent ([7de5d6f](https://github.com/stacksjs/postline/commit/7de5d6f)) _(by Chris)_
- **auth**: bypass login for local native app ([e8e3f72](https://github.com/stacksjs/postline/commit/e8e3f72)) _(by Chris)_
- **cloud**: stop shipping the local database to the server ([73b6838](https://github.com/stacksjs/postline/commit/73b6838)) _(by Chris)_
- **database**: keep the database out of the release tree ([a731ed2](https://github.com/stacksjs/postline/commit/a731ed2)) _(by Chris)_
- **cloud**: run Postline's own API process ([c12cd88](https://github.com/stacksjs/postline/commit/c12cd88)) _(by Chris)_
- **marketing**: prune generated pages whose slug is gone ([545a823](https://github.com/stacksjs/postline/commit/545a823)) _(by Chris)_

## ⚡ Performance Improvements

- **ci**: skip redundant deploy bootstrap ([451ae44](https://github.com/stacksjs/postline/commit/451ae44)) _(by Chris Breuer)_
- **router**: skip the action prefetch for safe-method routes ([99c9da0](https://github.com/stacksjs/postline/commit/99c9da0)) _(by Chris)_
- **logging**: cheap-exit log.debug when the configured level suppresses it ([63e7029](https://github.com/stacksjs/postline/commit/63e7029)) _(by Chris)_
- **router**: clear the per-middleware timeout timer after the race settles ([12fd2eb](https://github.com/stacksjs/postline/commit/12fd2eb)) _(by Chris)_
- **storage**: lazy-load the S3 client to keep ts-cloud off the import path ([74966ef](https://github.com/stacksjs/postline/commit/74966ef)) _(by Chris)_
- **orm**: lazy-load Babel in model AST helpers to speed dev boot ([c1aac9d](https://github.com/stacksjs/postline/commit/c1aac9d)) _(by Chris)_
- **dev**: keep Docs default-on but off the readiness gate ([4b464ed](https://github.com/stacksjs/postline/commit/4b464ed)) _(by Chris)_
- **dev**: parallelize primitive auto-imports and tighten the readiness poll ([173b032](https://github.com/stacksjs/postline/commit/173b032)) _(by Chris)_
- **dev**: skip the redundant preloader auto-import pass for dev servers ([d05523b](https://github.com/stacksjs/postline/commit/d05523b)) _(by Chris)_

## ♻️ Code Refactoring

- rename the app back to Postline ([d4cd91e](https://github.com/stacksjs/postline/commit/d4cd91e)) _(by Chris)_
- **newsletter**: use mail.sendOrFail rather than inspecting the result ([d64d5ee](https://github.com/stacksjs/postline/commit/d64d5ee)) _(by glennmichael123)_ ([stacksjs/stacks#2930](https://github.com/stacksjs/stacks/issues/2930), [#2930](https://github.com/stacksjs/postline/issues/2930))
- **theme**: own the pre-paint stamp in config, not in four places ([1a900e7](https://github.com/stacksjs/postline/commit/1a900e7)) _(by glennmichael123)_ ([stacksjs/stx#1788](https://github.com/stacksjs/stx/issues/1788), [stacksjs/stx#1794](https://github.com/stacksjs/stx/issues/1794))
- rename Postline to The Open Times ([c044c63](https://github.com/stacksjs/postline/commit/c044c63)) _(by Chris Breuer)_
- **accounts**: render the purge results declaratively ([8c0491f](https://github.com/stacksjs/postline/commit/8c0491f)) _(by glennmichael123)_
- **accounts**: replace the prohibited DOM patterns with composables ([159c73c](https://github.com/stacksjs/postline/commit/159c73c)) _(by glennmichael123)_
- **database**: regenerate schema from app models ([8af35f1](https://github.com/stacksjs/postline/commit/8af35f1)) _(by Chris)_
- **stx**: let stx own the document shell for the marketing layout ([f4aac40](https://github.com/stacksjs/postline/commit/f4aac40)) _(by glennmichael123)_ ([stacksjs/stx#1798](https://github.com/stacksjs/stx/issues/1798))
- **social**: re-export the shared types instead of copying them ([cc7947f](https://github.com/stacksjs/postline/commit/cc7947f)) _(by glennmichael123)_ ([stacksjs/stacks#2207](https://github.com/stacksjs/stacks/issues/2207))
- **types**: drop the ambient .d.ts for script-block locals ([2c9a850](https://github.com/stacksjs/postline/commit/2c9a850)) _(by glennmichael123)_
- **composer**: render the provider chips declaratively ([ba1961b](https://github.com/stacksjs/postline/commit/ba1961b)) _(by glennmichael123)_
- **composer**: replace the prohibited DOM patterns with composables ([32b77a2](https://github.com/stacksjs/postline/commit/32b77a2)) _(by glennmichael123)_
- **stx**: let stx own the document shell for the app layout ([267d47f](https://github.com/stacksjs/postline/commit/267d47f)) _(by glennmichael123)_ ([stacksjs/stx#1798](https://github.com/stacksjs/stx/issues/1798))
- **css**: move the mega-menu CSS into preflights ([3c15ee3](https://github.com/stacksjs/postline/commit/3c15ee3)) _(by glennmichael123)_
- **types**: annotate every parameter and return in the converted views ([a3e3f87](https://github.com/stacksjs/postline/commit/a3e3f87)) _(by glennmichael123)_
- **css**: move all CSS into config/crosswind.ts preflights ([2d10694](https://github.com/stacksjs/postline/commit/2d10694)) _(by glennmichael123)_
- **social**: use the upstream socials drivers ([0b0d93f](https://github.com/stacksjs/postline/commit/0b0d93f)) _(by Chris)_
- **stx**: bind layout keyboard shortcuts with useEventListener ([d7515ad](https://github.com/stacksjs/postline/commit/d7515ad)) _(by glennmichael123)_ ([stacksjs/stx#1794](https://github.com/stacksjs/stx/issues/1794))
- **stx**: drive login and settings with directives ([1ae1c81](https://github.com/stacksjs/postline/commit/1ae1c81)) _(by glennmichael123)_ ([stacksjs/stx#1794](https://github.com/stacksjs/stx/issues/1794), [#1788](https://github.com/stacksjs/postline/issues/1788))
- **stx**: drive timeline and queue with directives ([6edee2d](https://github.com/stacksjs/postline/commit/6edee2d)) _(by glennmichael123)_ ([stacksjs/stx#1793](https://github.com/stacksjs/stx/issues/1793))
- convert app views to semantic Crosswind tokens ([963ab74](https://github.com/stacksjs/postline/commit/963ab74)) _(by glennmichael123)_

## 📝 Documentation

- **ci**: record why the Mac runner's load limit is 6 per CPU ([ef16adb](https://github.com/stacksjs/postline/commit/ef16adb)) _(by Chris)_
- **ui**: the dark tokens key off the class, not the attribute ([10fac33](https://github.com/stacksjs/postline/commit/10fac33)) _(by glennmichael123)_
- **env,accounts**: X is pay-per-use now, and links cost more ([7039493](https://github.com/stacksjs/postline/commit/7039493)) _(by glennmichael123)_
- desktop build, release and App Store runbook ([6c80f3e](https://github.com/stacksjs/postline/commit/6c80f3e)) _(by Chris)_
- **stx**: normalize audit code spans ([46238a8](https://github.com/stacksjs/postline/commit/46238a8)) _(by Chris)_
- **social**: correct the PublishPostInput note ([096dbea](https://github.com/stacksjs/postline/commit/096dbea)) _(by glennmichael123)_
- **gate**: record that the stx gate is now upstream ([e1711a2](https://github.com/stacksjs/postline/commit/e1711a2)) _(by glennmichael123)_ ([stacksjs/stacks#2206](https://github.com/stacksjs/stacks/issues/2206))
- record why the last two stx conversions are blocked ([d80759d](https://github.com/stacksjs/postline/commit/d80759d)) _(by glennmichael123)_ ([stacksjs/stx#1798](https://github.com/stacksjs/stx/issues/1798), [stacksjs/stx#1799](https://github.com/stacksjs/stx/issues/1799))
- **env**: document the desktop build keys ([715ffc2](https://github.com/stacksjs/postline/commit/715ffc2)) _(by Chris)_
- **deps**: correct why bunfig is pinned ([db0a90c](https://github.com/stacksjs/postline/commit/db0a90c)) _(by Chris)_
- record the stx-native migration standard and runtime findings ([f8abaae](https://github.com/stacksjs/postline/commit/f8abaae)) _(by glennmichael123)_
- record the stx standards audit ([8d6a5d9](https://github.com/stacksjs/postline/commit/8d6a5d9)) _(by glennmichael123)_
- design and plan for media upload and per-network variants ([595ed0d](https://github.com/stacksjs/postline/commit/595ed0d)) _(by glennmichael123)_ ([#18](https://github.com/stacksjs/postline/issues/18))
- forbid AI attribution in commit messages and PRs ([1fa8661](https://github.com/stacksjs/postline/commit/1fa8661)) _(by glennmichael123)_
- link the community as stacksjs.com/discord ([d82c4f7](https://github.com/stacksjs/postline/commit/d82c4f7)) _(by Chris)_

## 💄 Styles

- **app**: refine product UI system ([c32cff1](https://github.com/stacksjs/postline/commit/c32cff1)) _(by Chris Breuer)_
- **accounts**: normalize channel settings ([e0a929d](https://github.com/stacksjs/postline/commit/e0a929d)) _(by Chris)_
- normalize analytics comment indentation ([ddaec62](https://github.com/stacksjs/postline/commit/ddaec62)) _(by Chris)_
- pickier --fix class-order and formatting cleanups ([52c26cf](https://github.com/stacksjs/postline/commit/52c26cf)) _(by glennmichael123)_

## ✅ Tests

- **crosspost**: pin thread chaining, and lift its rules out of the DB write ([a5debcc](https://github.com/stacksjs/postline/commit/a5debcc)) _(by glennmichael123)_ ([#40](https://github.com/stacksjs/postline/issues/40))
- **purge**: pin postline as purgeable ([0ae8db7](https://github.com/stacksjs/postline/commit/0ae8db7)) _(by Chris Breuer)_
- **social**: cover driver deletes and purge safeguards ([d980f18](https://github.com/stacksjs/postline/commit/d980f18)) _(by Chris)_
- cover the Bluesky publish path at the driver level ([30f199a](https://github.com/stacksjs/postline/commit/30f199a)) _(by glennmichael123)_

## 💚 Continuous Integration

- retire the GitHub Actions CI and release workflows ([f789d8a](https://github.com/stacksjs/postline/commit/f789d8a)) _(by Chris)_ ([#2](https://github.com/stacksjs/postline/issues/2))
- run every job on Postline's own Mac runner ([082a363](https://github.com/stacksjs/postline/commit/082a363)) _(by Chris)_
- run CI and the desktop release on ReviewOS ([ebf68b8](https://github.com/stacksjs/postline/commit/ebf68b8)) _(by Chris)_
- verify the canonical host, and the realtime route with it ([e01406e](https://github.com/stacksjs/postline/commit/e01406e)) _(by Chris Breuer)_
- deploy main to production ([ac1bcd8](https://github.com/stacksjs/postline/commit/ac1bcd8)) _(by Chris Breuer)_
- **stx**: add the pre-merge gate as a ratchet ([4282022](https://github.com/stacksjs/postline/commit/4282022)) _(by glennmichael123)_
- **buddy-bot**: add daily cleanup cron to workflow ([7ffe157](https://github.com/stacksjs/postline/commit/7ffe157)) _(by Glenn Michael Torregosa)_
- **buddy-bot**: regenerate workflow from current template ([55f08a7](https://github.com/stacksjs/postline/commit/55f08a7)) _(by Glenn Michael Torregosa)_

## 🔧 Chores

- release v0.1.0 ([3683a28](https://github.com/stacksjs/postline/commit/3683a28)) _(by Chris)_
- **deploy**: move to the Postline host and turn automatic deploys off ([cf39763](https://github.com/stacksjs/postline/commit/cf39763)) _(by Chris)_
- **deps**: upgrade Stacks to 0.75.599, and fix what the upgrade surfaced ([77253c2](https://github.com/stacksjs/postline/commit/77253c2)) _(by Chris)_
- **social**: stop offering facebook and tiktok, which have no driver ([f2a1de2](https://github.com/stacksjs/postline/commit/f2a1de2)) _(by glennmichael123)_
- **stx**: suppress the justified DOM-guard violations, leave the rest warning ([01d8cb3](https://github.com/stacksjs/postline/commit/01d8cb3)) _(by glennmichael123)_ ([stacksjs/stx#2049](https://github.com/stacksjs/stx/issues/2049), [stacksjs/stx#2097](https://github.com/stacksjs/stx/issues/2097))
- **lint**: leave the vendored framework defaults to upstream ([65ef033](https://github.com/stacksjs/postline/commit/65ef033)) _(by Chris)_
- **deps**: upgrade Stacks to 0.75.87 ([968d74c](https://github.com/stacksjs/postline/commit/968d74c)) _(by Chris)_
- **deps**: ts-cloud 0.7.124 for declared unit priority ([b427bcb](https://github.com/stacksjs/postline/commit/b427bcb)) _(by Chris Breuer)_
- **deps**: close the render leak, and size main to its workload ([66cd78b](https://github.com/stacksjs/postline/commit/66cd78b)) _(by Chris Breuer)_
- **deps**: pin stx 0.2.180 for the transpiler-pool fix ([cac3037](https://github.com/stacksjs/postline/commit/cac3037)) _(by Chris Breuer)_
- **deploy**: pin ts-cloud 0.7.120, and give each site a memory ceiling ([ad608e0](https://github.com/stacksjs/postline/commit/ad608e0)) _(by Chris Breuer)_
- **deps**: stacks 0.70.294, which verifies the mail zone it publishes ([9206a8a](https://github.com/stacksjs/postline/commit/9206a8a)) _(by Chris Breuer)_
- **deps**: stacks 0.70.293, with the DMARC duplicate fix ([53dae1a](https://github.com/stacksjs/postline/commit/53dae1a)) _(by Chris Breuer)_
- **deps**: pull in the mail DNS fix (stacks 0.70.287) ([4113b5c](https://github.com/stacksjs/postline/commit/4113b5c)) _(by Chris Breuer)_
- **env**: set production mail credentials ([25124d1](https://github.com/stacksjs/postline/commit/25124d1)) _(by Chris Breuer)_
- **deps**: update Stacks to 0.70.255 ([4804d73](https://github.com/stacksjs/postline/commit/4804d73)) _(by Chris)_
- **deps**: add Stacks AI runtime ([d93f7dd](https://github.com/stacksjs/postline/commit/d93f7dd)) _(by Chris)_
- **framework**: refresh vendored Stacks defaults ([dd07aad](https://github.com/stacksjs/postline/commit/dd07aad)) _(by Chris)_
- **deps**: upgrade Stacks and add Lucide icons ([be37c77](https://github.com/stacksjs/postline/commit/be37c77)) _(by Chris)_
- **qa**: remove temporary screenshots ([34ab00a](https://github.com/stacksjs/postline/commit/34ab00a)) _(by Chris)_
- remove the scripts added by this migration ([6a75bd9](https://github.com/stacksjs/postline/commit/6a75bd9)) _(by glennmichael123)_ ([stacksjs/stacks#2206](https://github.com/stacksjs/stacks/issues/2206))
- wip ([6d4e25f](https://github.com/stacksjs/postline/commit/6d4e25f)) _(by Chris)_
- **deps**: move onto stx 0.2.152 ([5bc68f8](https://github.com/stacksjs/postline/commit/5bc68f8)) _(by glennmichael123)_
- **deps**: refresh the lockfile onto stacks 0.70.251 ([42e18fc](https://github.com/stacksjs/postline/commit/42e18fc)) _(by glennmichael123)_ ([stacksjs/stx#1793](https://github.com/stacksjs/stx/issues/1793))
- **deps**: move onto stacks 0.70.231 ([7795ace](https://github.com/stacksjs/postline/commit/7795ace)) _(by Chris)_
- **deps**: drop the bunfig override ([0e3bf8a](https://github.com/stacksjs/postline/commit/0e3bf8a)) _(by Chris)_
- **deps**: move onto stx 0.2.148 and bunfig 0.15.17 where possible ([56da0b4](https://github.com/stacksjs/postline/commit/56da0b4)) _(by Chris)_
- **deps**: refresh the lockfile onto stx 0.2.147 ([1f4324d](https://github.com/stacksjs/postline/commit/1f4324d)) _(by Chris)_
- **deps**: drop the Crosswind override ([18e1432](https://github.com/stacksjs/postline/commit/18e1432)) _(by Chris)_
- **scripts**: add a workspace account seeder ([fdd7bc5](https://github.com/stacksjs/postline/commit/fdd7bc5)) _(by glennmichael123)_
- **deps**: bump the stx toolchain to 0.2.119 ([d20654c](https://github.com/stacksjs/postline/commit/d20654c)) _(by glennmichael123)_
- wip ([c1af322](https://github.com/stacksjs/postline/commit/c1af322)) _(by glennmichael123)_
- **framework**: update Stacks to 0.70.217 ([3ec5778](https://github.com/stacksjs/postline/commit/3ec5778)) _(by Chris)_
- **framework**: update Stacks to 0.70.216 ([6e08b6b](https://github.com/stacksjs/postline/commit/6e08b6b)) _(by Chris)_
- **framework**: refresh npm-backed scaffolding ([737f66b](https://github.com/stacksjs/postline/commit/737f66b)) _(by Chris)_
- wip ([2f43855](https://github.com/stacksjs/postline/commit/2f43855)) _(by Chris)_
- update AI skills to latest upstream (93 → 105) ([e00270a](https://github.com/stacksjs/postline/commit/e00270a)) _(by glennmichael123)_
- **deps**: upgrade vendored Stacks framework to 0.70.163 (#29) ([790eac9](https://github.com/stacksjs/postline/commit/790eac9)) _(by Glenn Michael Torregosa)_ ([#29](https://github.com/stacksjs/postline/issues/29))
- upgrade vendored Stacks 0.70.45 → 0.70.162 ([e24cbdd](https://github.com/stacksjs/postline/commit/e24cbdd)) _(by glennmichael123)_ ([#25](https://github.com/stacksjs/postline/issues/25), [stacksjs/stacks#2072](https://github.com/stacksjs/stacks/issues/2072), [stacksjs/dtsx#3103](https://github.com/stacksjs/dtsx/issues/3103), [#1930](https://github.com/stacksjs/postline/issues/1930), [#1952](https://github.com/stacksjs/postline/issues/1952))
- adopt framework-as-dependencies (drop vendored storage/framework) ([20b17f4](https://github.com/stacksjs/postline/commit/20b17f4)) _(by glennmichael123)_
- wip ([17f479c](https://github.com/stacksjs/postline/commit/17f479c)) _(by Chris)_
- **deps**: bump @stacksjs/ts-cloud to ^0.7.26 ([9917932](https://github.com/stacksjs/postline/commit/9917932)) _(by Chris)_
- **deps**: declare bun ^1.3.14 in deps.yaml ([305aad4](https://github.com/stacksjs/postline/commit/305aad4)) _(by Chris)_
- drop redundant ts-cloud deps (transitive via the stacks meta) ([117c816](https://github.com/stacksjs/postline/commit/117c816)) _(by Chris)_
- make the bundled dashboard routes toggleable via config ([9b0853e](https://github.com/stacksjs/postline/commit/9b0853e)) _(by Chris)_
- **deps**: bump @stacksjs/bun-router to ^0.0.16 ([7705536](https://github.com/stacksjs/postline/commit/7705536)) _(by Chris)_
- **deps**: bump @stacksjs/rpx to ^0.11.13 ([74f24ab](https://github.com/stacksjs/postline/commit/74f24ab)) _(by Chris)_
- wip ([e92d764](https://github.com/stacksjs/postline/commit/e92d764)) _(by Chris)_
- **buddy**: bump @stacksjs/rpx to ^0.11.8 ([8638464](https://github.com/stacksjs/postline/commit/8638464)) _(by Chris)_
- wip ([1334358](https://github.com/stacksjs/postline/commit/1334358)) _(by Chris)_

## 🎉 Miscellaneous

- Revert "chore: release v0.1.0" ([0c837d6](https://github.com/stacksjs/postline/commit/0c837d6)) _(by Chris)_
- Merge fix/dark-toasts-and-load-spam: dark-mode QA fixes ([b1bc045](https://github.com/stacksjs/postline/commit/b1bc045)) _(by glennmichael123)_
- Merge refactor/crosswind-semantic-tokens: app views on semantic tokens ([e1ff08c](https://github.com/stacksjs/postline/commit/e1ff08c)) _(by glennmichael123)_
- Merge feat/landing-page: /welcome landing page ([00dec2a](https://github.com/stacksjs/postline/commit/00dec2a)) _(by glennmichael123)_
- Merge pull request #32 from stacksjs/chore/update-ai-skills ([e9cfee3](https://github.com/stacksjs/postline/commit/e9cfee3)) _(by Glenn Michael Torregosa)_ ([#32](https://github.com/stacksjs/postline/issues/32))
- Merge pull request #31 from stacksjs/fix/readiness-batch-1-feedback-timing ([64e430d](https://github.com/stacksjs/postline/commit/64e430d)) _(by Glenn Michael Torregosa)_ ([#31](https://github.com/stacksjs/postline/issues/31))
- Merge pull request #30 from stacksjs/feat/crosspost-media-and-token-refresh ([a86e36d](https://github.com/stacksjs/postline/commit/a86e36d)) _(by Glenn Michael Torregosa)_ ([#30](https://github.com/stacksjs/postline/issues/30))
- Merge pull request #28 from stacksjs/chore/upgrade-0.70.162 ([8553bd3](https://github.com/stacksjs/postline/commit/8553bd3)) _(by Glenn Michael Torregosa)_ ([#28](https://github.com/stacksjs/postline/issues/28))
- Merge pull request #27 from stacksjs/feat/dark-mode ([6a7b78b](https://github.com/stacksjs/postline/commit/6a7b78b)) _(by Glenn Michael Torregosa)_ ([#27](https://github.com/stacksjs/postline/issues/27))
- Merge pull request #26 from stacksjs/feat/mastodon-driver ([89c9705](https://github.com/stacksjs/postline/commit/89c9705)) _(by Glenn Michael Torregosa)_ ([#26](https://github.com/stacksjs/postline/issues/26))
- Merge pull request #24 from stacksjs/feat/bluesky-publish-hardening ([afd422a](https://github.com/stacksjs/postline/commit/afd422a)) _(by Glenn Michael Torregosa)_ ([#24](https://github.com/stacksjs/postline/issues/24), [#17](https://github.com/stacksjs/postline/issues/17))
- Merge pull request #23 from stacksjs/feat/queue-calendar ([f5b3733](https://github.com/stacksjs/postline/commit/f5b3733)) _(by Glenn Michael Torregosa)_ ([#23](https://github.com/stacksjs/postline/issues/23), [#20](https://github.com/stacksjs/postline/issues/20))
- Merge pull request #22 from stacksjs/feat/edit-queued-posts ([a124d8f](https://github.com/stacksjs/postline/commit/a124d8f)) _(by Glenn Michael Torregosa)_ ([#22](https://github.com/stacksjs/postline/issues/22), [#21](https://github.com/stacksjs/postline/issues/21))
- Merge pull request #16 from stacksjs/revert/framework-deps-migration ([8701fca](https://github.com/stacksjs/postline/commit/8701fca)) _(by Glenn Michael Torregosa)_ ([#16](https://github.com/stacksjs/postline/issues/16), [#15](https://github.com/stacksjs/postline/issues/15))
- Revert "Merge pull request #15 from stacksjs/chore/adopt-framework-deps" ([5218a19](https://github.com/stacksjs/postline/commit/5218a19)) _(by glennmichael123)_ ([#15](https://github.com/stacksjs/postline/issues/15))
- Merge pull request #15 from stacksjs/chore/adopt-framework-deps ([f606a34](https://github.com/stacksjs/postline/commit/f606a34)) _(by Glenn Michael Torregosa)_ ([#15](https://github.com/stacksjs/postline/issues/15))
- Merge pull request #13 from stacksjs/feat/queue-content ([975d6ca](https://github.com/stacksjs/postline/commit/975d6ca)) _(by Glenn Michael Torregosa)_ ([#13](https://github.com/stacksjs/postline/issues/13))
- Merge pull request #12 from stacksjs/feat/metrics-sync ([53a502e](https://github.com/stacksjs/postline/commit/53a502e)) _(by Glenn Michael Torregosa)_ ([#12](https://github.com/stacksjs/postline/issues/12))
- Merge pull request #11 from stacksjs/feat/auth ([723fe12](https://github.com/stacksjs/postline/commit/723fe12)) _(by Glenn Michael Torregosa)_ ([#11](https://github.com/stacksjs/postline/issues/11))
- Merge pull request #10 from stacksjs/feat/blog-longform ([0a3f643](https://github.com/stacksjs/postline/commit/0a3f643)) _(by Glenn Michael Torregosa)_ ([#10](https://github.com/stacksjs/postline/issues/10))
- Merge pull request #9 from stacksjs/feat/bluesky-publishing-v2 ([89861eb](https://github.com/stacksjs/postline/commit/89861eb)) _(by Glenn Michael Torregosa)_ ([#9](https://github.com/stacksjs/postline/issues/9))
- Merge pull request #8 from stacksjs/feat/ui-polish ([c77edd0](https://github.com/stacksjs/postline/commit/c77edd0)) _(by Glenn Michael Torregosa)_ ([#8](https://github.com/stacksjs/postline/issues/8))
- Merge pull request #4 from stacksjs/fix/rpx-https-deps ([b2e22d6](https://github.com/stacksjs/postline/commit/b2e22d6)) _(by Chris)_ ([#4](https://github.com/stacksjs/postline/issues/4))
- Merge pull request #3 from stacksjs/fix/buddy-dev-rpx-crash ([15f88ee](https://github.com/stacksjs/postline/commit/15f88ee)) _(by Chris)_ ([#3](https://github.com/stacksjs/postline/issues/3))
- Merge pull request #2 from stacksjs/fix/crosspost-ui-polish ([fdfec10](https://github.com/stacksjs/postline/commit/fdfec10)) _(by Chris)_ ([#2](https://github.com/stacksjs/postline/issues/2))
- Merge pull request #1 from stacksjs/feat/crosspost-linkedin-instagram ([e51256f](https://github.com/stacksjs/postline/commit/e51256f)) _(by Chris)_ ([#1](https://github.com/stacksjs/postline/issues/1))
- Upgrade Stacks framework to v0.70.44 ([ddab48f](https://github.com/stacksjs/postline/commit/ddab48f)) _(by Chris)_
- Enable Iconify utilities in Postline ([1d93939](https://github.com/stacksjs/postline/commit/1d93939)) _(by Chris)_
- Persist composer drafts across navigation ([2c31c8a](https://github.com/stacksjs/postline/commit/2c31c8a)) _(by Chris)_

## wip

- landing page — foundation + hero (Phases 0–1) ([964a8b8](https://github.com/stacksjs/postline/commit/964a8b8)) _(by glennmichael123)_

## Contributors

- _Chris_
- _Chris Breuer_
- _Glenn Michael Torregosa_
- _glennmichael123_
