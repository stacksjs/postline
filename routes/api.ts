import { route } from '@stacksjs/router'
import { csrfSeedResponse } from '../app/Support/Http/csrf-cookie'
import { isMarketingSite } from '../app/Support/Marketing/site'
import { assertSafeDeployment } from '../app/Support/Http/deployment-guard'

/**
 * This file is the entry point for your application's API routes.
 * The routes defined here are automatically registered. Last but
 * not least, you may also create any other `routes/*.ts` files.
 *
 * The framework's bundled routes (dashboard, commerce, CMS and the rest) are
 * switched off in `config/dashboard.ts`, so this file is the whole API.
 * `tests/feature/public-routes.test.ts` pins which routes answer without a
 * session; a new public route has to be added there on purpose.
 *
 * @see https://docs.stacksjs.com/routing
 */

// Checked before a single route exists: a development build must not serve an
// address other machines can reach.
assertSafeDeployment()

// Your custom routes go here:
// Auth: the framework's /login lives in the bundled dashboard routes, which
// this app keeps off (`config/dashboard.ts`), so it is declared directly.
route.post('/login', 'Actions/Auth/LoginAction').rateLimit(5, 'minute')
// Single-user workspace: /register only works until the first account exists.
route.post('/register', 'Actions/Postline/RegisterFirstUserAction').rateLimit(3, 'minute')
// Sign-out needs a server round trip, for the same reason sign-in does: the
// session lives in an httpOnly cookie, so the browser cannot end it on its own.
// The framework action revokes the token AND clears the cookie — doing only the
// second would leave a copied cookie usable for the token's full 30 days, which
// would make "sign out" mean "hide the key". Unauthenticated on purpose: a
// logout carrying a dead cookie should still clear it rather than answer 401.
route.post('/logout', 'Actions/Auth/LogoutAction')
// Every session and token the owner has, this browser included (#93). Needs a
// session: there is nobody to sign out of everywhere without one.
route.post('/logout-all', 'Actions/Auth/LogoutAllAction').middleware('auth').rateLimit(10, 'minute')

// Passkeys and two-factor sign-in (#95), the framework's ceremonies. Signing in
// with a passkey is public, as signing in is; adding or removing one, and
// everything about the authenticator app, needs the session. The password
// stays a way in, so a lost passkey or phone never locks the owner out, and
// turning the authenticator off asks for it again.
route.post('/auth/passkeys/authentication/options', 'Actions/Auth/PasskeyAuthenticationOptionsAction').rateLimit(10, 'minute')
route.post('/auth/passkeys/authentication', 'Actions/Auth/PasskeyAuthenticationAction').rateLimit(10, 'minute')
route.post('/auth/passkeys/registration/options', 'Actions/Auth/PasskeyRegistrationOptionsAction').middleware('auth').rateLimit(5, 'minute')
route.post('/auth/passkeys/registration', 'Actions/Auth/PasskeyRegistrationAction').middleware('auth').rateLimit(5, 'minute')
route.get('/auth/passkeys', 'Actions/Auth/PasskeyIndexAction').middleware('auth')
route.delete('/auth/passkeys/{id}', 'Actions/Auth/PasskeyDestroyAction').middleware('auth').rateLimit(10, 'minute')
route.get('/auth/two-factor', 'Actions/Postline/SignInSecurityAction').middleware('auth')
route.post('/auth/two-factor/setup', 'Actions/Auth/GenerateTwoFactorSecretAction').middleware('auth').rateLimit(10, 'minute')
route.post('/auth/two-factor/enable', 'Actions/Auth/EnableTwoFactorAction').middleware('auth').rateLimit(10, 'minute')
route.post('/auth/two-factor/disable', 'Actions/Auth/DisableTwoFactorAction').middleware('auth').rateLimit(10, 'minute')
route.post('/auth/two-factor/recovery-codes', 'Actions/Postline/RecoveryCodesAction').middleware('auth').rateLimit(5, 'minute')
// The second step of /login: the password answered with a short-lived
// challenge, and this trades it plus a code for the session.
route.post('/auth/two-factor/verify', 'Actions/Auth/VerifyTwoFactorLoginAction').rateLimit(10, 'minute')

// Hands a browser its CSRF cookie. Every write made with the session cookie
// has to echo that cookie's value in a header (see CsrfScripts.stx). Pages and
// API responses set it as they go on the web server; the desktop agent does
// not, and a page can outlive the cookie, so this sets it explicitly. It reads
// and changes nothing else.
route.get('/csrf', request => csrfSeedResponse(request as unknown as Request))

// The hosted-plan waitlist on the marketing site. The framework action owns
// rate limiting, the honeypot and the confirmation mail; this just exposes it.
// Unauthenticated by necessity, so the action's per-IP throttle is the guard.
// Only the marketing deployment mounts it: an install has no waitlist.
if (isMarketingSite())
  route.post('/subscribe', 'Actions/SubscriberEmailAction')

// Public: Instagram/Threads fetch a queued post's image server-side, so this
// route is intentionally unauthenticated. The filename is an unguessable
// per-upload UUID and strictly validated against traversal (MediaServeAction).
route.get('/postline/media', 'Actions/Postline/MediaServeAction').rateLimit(120, 'minute')
route.get('/postline/blog/media', 'Actions/Postline/BlogMediaAction').rateLimit(120, 'minute')

// For a load balancer or an uptime monitor: fails when the scheduler has
// stopped, which the framework's own health check cannot see.
route.get('/postline/health', 'Actions/Postline/HealthAction').rateLimit(120, 'minute')
route.get('/postline/setup/availability', 'Actions/Postline/SetupAvailabilityAction').rateLimit(60, 'minute')

route.group({ prefix: '/postline/bluesky' }, () => {
  route.get('/status', 'Actions/Postline/BlueskyStatusAction').middleware('auth')
  route.post('/connect', 'Actions/Postline/BlueskyConnectAction').middleware('auth').rateLimit(10, 'minute')
  route.post('/publish', 'Actions/Postline/BlueskyPublishAction').middleware('auth').rateLimit(30, 'minute')
  route.get('/link-preview', 'Actions/Postline/BlueskyLinkPreviewAction').middleware('auth').rateLimit(60, 'minute')
  route.get('/timeline', 'Actions/Postline/BlueskyTimelineAction').middleware('auth').rateLimit(60, 'minute')
})

route.group({ prefix: '/postline/linkedin' }, () => {
  route.get('/status', 'Actions/Postline/LinkedInStatusAction').middleware('auth')
  route.post('/connect', 'Actions/Postline/LinkedInConnectAction').middleware('auth').rateLimit(10, 'minute')
  route.get('/auth', 'Actions/Postline/LinkedInAuthAction').middleware('auth').rateLimit(10, 'minute')
  route.get('/callback', 'Actions/Postline/LinkedInCallbackAction').middleware('auth').rateLimit(10, 'minute')
})

route.group({ prefix: '/postline/instagram' }, () => {
  route.get('/status', 'Actions/Postline/InstagramStatusAction').middleware('auth')
  route.post('/connect', 'Actions/Postline/InstagramConnectAction').middleware('auth').rateLimit(10, 'minute')
  route.get('/auth', 'Actions/Postline/InstagramAuthAction').middleware('auth').rateLimit(10, 'minute')
  route.get('/callback', 'Actions/Postline/InstagramCallbackAction').middleware('auth').rateLimit(10, 'minute')
})

route.group({ prefix: '/postline/threads' }, () => {
  route.get('/status', 'Actions/Postline/ThreadsStatusAction').middleware('auth')
  route.post('/connect', 'Actions/Postline/ThreadsConnectAction').middleware('auth').rateLimit(10, 'minute')
  route.get('/auth', 'Actions/Postline/ThreadsAuthAction').middleware('auth').rateLimit(10, 'minute')
  route.get('/callback', 'Actions/Postline/ThreadsCallbackAction').middleware('auth').rateLimit(10, 'minute')
})

route.group({ prefix: '/postline/twitter' }, () => {
  route.get('/status', 'Actions/Postline/TwitterStatusAction').middleware('auth')
  route.post('/connect', 'Actions/Postline/TwitterConnectAction').middleware('auth').rateLimit(10, 'minute')
  route.get('/auth', 'Actions/Postline/TwitterAuthAction').middleware('auth').rateLimit(10, 'minute')
  route.get('/callback', 'Actions/Postline/TwitterCallbackAction').middleware('auth').rateLimit(10, 'minute')
})

route.group({ prefix: '/postline/mastodon' }, () => {
  route.get('/status', 'Actions/Postline/MastodonStatusAction').middleware('auth')
  route.post('/connect', 'Actions/Postline/MastodonConnectAction').middleware('auth').rateLimit(10, 'minute')
})

route.group({ prefix: '/postline' }, () => {
  route.get('/bootstrap', 'Actions/Postline/WorkspaceBootstrapAction').middleware('auth')
  route.get('/setup/post-status', 'Actions/Postline/SetupPostStatusAction').middleware('auth')
  route.get('/providers', 'Actions/Postline/ProvidersStatusAction').middleware('auth')
  // Connected accounts across networks (several per network allowed).
  // Disconnecting drops the tokens but keeps the row, so post history stays
  // attributed; throttled like the other single-row writes.
  route.get('/accounts', 'Actions/Postline/AccountListAction').middleware('auth')
  // The owner's own developer app per OAuth network (bring your own keys).
  route.get('/network-apps', 'Actions/Postline/NetworkAppListAction').middleware('auth')
  route.post('/network-apps', 'Actions/Postline/NetworkAppSaveAction').middleware('auth').rateLimit(30, 'minute')
  route.post('/network-apps/clear', 'Actions/Postline/NetworkAppClearAction').middleware('auth').rateLimit(30, 'minute')
  route.post('/accounts/disconnect', 'Actions/Postline/AccountDisconnectAction').middleware('auth').rateLimit(30, 'minute')
  route.post('/accounts/default', 'Actions/Postline/AccountDefaultAction').middleware('auth').rateLimit(30, 'minute')
  route.post('/publish', 'Actions/Postline/CrosspostPublishAction').middleware('auth').rateLimit(30, 'minute')
  route.get('/unread', 'Actions/Postline/UnreadCountsAction').middleware('auth')
  route.get('/analytics', 'Actions/Postline/AnalyticsAction').middleware('auth')
  route.get('/blog', 'Actions/Postline/BlogListAction').middleware('auth')
  route.post('/blog/preview', 'Actions/Postline/BlogPreviewAction').middleware('auth').rateLimit(240, 'minute')
  route.post('/blog/update', 'Actions/Postline/BlogUpdateAction').middleware('auth').rateLimit(60, 'minute')
  route.post('/blog/unpublish', 'Actions/Postline/BlogUnpublishAction').middleware('auth').rateLimit(30, 'minute')
  route.post('/blog/republish', 'Actions/Postline/BlogRepublishAction').middleware('auth').rateLimit(30, 'minute')
  route.post('/blog/delete', 'Actions/Postline/BlogDeleteAction').middleware('auth').rateLimit(30, 'minute')
  route.get('/queue', 'Actions/Postline/QueueListAction').middleware('auth')
  route.get('/queue/item', 'Actions/Postline/QueueGetAction').middleware('auth')
  route.get('/queue/image', 'Actions/Postline/QueuePreviewImageAction').middleware('auth').rateLimit(240, 'minute')
  route.post('/queue', 'Actions/Postline/QueueSaveAction').middleware('auth').rateLimit(60, 'minute')
  route.post('/queue/update', 'Actions/Postline/QueueUpdateAction').middleware('auth').rateLimit(60, 'minute')
  route.post('/queue/reschedule', 'Actions/Postline/QueueRescheduleAction').middleware('auth').rateLimit(60, 'minute')
  route.post('/queue/delete', 'Actions/Postline/QueueDeleteAction').middleware('auth').rateLimit(60, 'minute')
  route.post('/queue/undo-delete', 'Actions/Postline/QueueUndoDeleteAction').middleware('auth').rateLimit(60, 'minute')
  route.post('/queue/publish-now', 'Actions/Postline/QueuePublishNowAction').middleware('auth').rateLimit(30, 'minute')
  route.post('/metrics/sync', 'Actions/Postline/MetricsSyncAction').middleware('auth').rateLimit(20, 'hour')
  route.get('/campaigns', 'Actions/Postline/CampaignListAction').middleware('auth')
  route.post('/campaigns', 'Actions/Postline/CampaignSaveAction').middleware('auth').rateLimit(60, 'minute')
  route.post('/campaigns/post', 'Actions/Postline/CampaignPostSaveAction').middleware('auth').rateLimit(120, 'minute')
  route.post('/campaigns/post/move', 'Actions/Postline/CampaignPostMoveAction').middleware('auth').rateLimit(240, 'minute')
  route.post('/campaigns/post/delete', 'Actions/Postline/CampaignPostDeleteAction').middleware('auth').rateLimit(60, 'minute')
  route.get('/campaigns/ai/status', 'Actions/Postline/CampaignAIStatusAction').middleware('auth')
  route.post('/campaigns/generate', 'Actions/Postline/CampaignGenerateAction').middleware('auth').rateLimit(10, 'hour')
  route.post('/campaigns/activate', 'Actions/Postline/CampaignActivateAction').middleware('auth').rateLimit(5, 'hour')
  // Import. Writes a lot of rows from one call, so it is throttled tightly.
  route.post('/import/posts', 'Actions/Postline/ImportPostsAction').middleware('auth').rateLimit(10, 'hour')

  // Direct messages. Reads hit the local mirror and are cheap; the two calls
  // that touch a network (sync, reply) are throttled, and replying tightest —
  // it is the only one here that is visible to someone else.
  route.get('/inbox', 'Actions/Postline/InboxListAction').middleware('auth')
  route.get('/inbox/thread', 'Actions/Postline/InboxThreadAction').middleware('auth')
  route.post('/inbox/sync', 'Actions/Postline/InboxSyncAction').middleware('auth').rateLimit(60, 'hour')
  route.post('/inbox/reply', 'Actions/Postline/InboxReplyAction').middleware('auth').rateLimit(60, 'hour')
  route.post('/inbox/read', 'Actions/Postline/InboxReadAction').middleware('auth').rateLimit(120, 'minute')
  route.post('/inbox/archive', 'Actions/Postline/InboxArchiveAction').middleware('auth').rateLimit(60, 'minute')
  route.get('/listening', 'Actions/Postline/KeywordMonitorListAction').middleware('auth')
  route.post('/listening', 'Actions/Postline/KeywordMonitorSaveAction').middleware('auth').rateLimit(30, 'minute')
  route.post('/listening/delete', 'Actions/Postline/KeywordMonitorDeleteAction').middleware('auth').rateLimit(20, 'minute')
  route.post('/listening/scan', 'Actions/Postline/KeywordMonitorScanAction').middleware('auth').rateLimit(20, 'hour')
  route.post('/listening/read', 'Actions/Postline/KeywordMentionReadAction').middleware('auth').rateLimit(120, 'minute')
  // Bulk post deletion. Irreversible, so both halves are auth-only and rate
  // limited — the preview generously, the destructive run tightly.
  route.get('/purge/preview', 'Actions/Postline/PurgePreviewAction').middleware('auth').rateLimit(20, 'minute')
  route.post('/purge', 'Actions/Postline/PurgeRunAction').middleware('auth').rateLimit(3, 'hour')
  route.get('/purge/status', 'Actions/Postline/PurgeStatusAction').middleware('auth').rateLimit(240, 'minute')
  route.post('/purge/cancel', 'Actions/Postline/PurgeCancelAction').middleware('auth').rateLimit(30, 'minute')
  // Automatic deletion of posts older than N days (Settings). The daily
  // AutoDeletePosts job does the deleting; these only read and save the rule.
  route.get('/system', 'Actions/Postline/SystemStatusAction').middleware('auth')
  // The Mac app's log in Finder; answers only inside the Mac app (#202).
  route.post('/desktop/reveal-log', 'Actions/Postline/DesktopRevealLogAction').middleware('auth').rateLimit(10, 'minute')
  route.get('/desktop/status', 'Actions/Postline/DesktopStatusAction').middleware('auth')
  route.get('/activity', 'Actions/Postline/ActivityAction').middleware('auth')
  route.get('/alerts', 'Actions/Postline/AlertListAction').middleware('auth')
  route.post('/alerts/read', 'Actions/Postline/AlertReadAction').middleware('auth').rateLimit(60, 'minute')
  route.get('/settings/workspace', 'Actions/Postline/WorkspaceGetAction').middleware('auth')
  route.post('/settings/workspace', 'Actions/Postline/WorkspaceSaveAction').middleware('auth').rateLimit(30, 'minute')
  // The workspace as one file, back in from one, or gone (#209).
  route.get('/settings/export', 'Actions/Postline/WorkspaceExportAction').middleware('auth').rateLimit(10, 'minute')
  route.post('/settings/import', 'Actions/Postline/WorkspaceImportAction').middleware('auth').rateLimit(5, 'minute')
  route.post('/settings/delete-everything', 'Actions/Postline/WorkspaceDeleteAction').middleware('auth').rateLimit(5, 'hour')
  route.get('/settings/ai', 'Actions/Postline/AISettingsGetAction').middleware('auth')
  route.post('/settings/ai', 'Actions/Postline/AISettingsSaveAction').middleware('auth').rateLimit(30, 'minute')
  route.get('/settings/retention', 'Actions/Postline/RetentionGetAction').middleware('auth')
  route.post('/settings/retention', 'Actions/Postline/RetentionSaveAction').middleware('auth').rateLimit(30, 'minute')
})
