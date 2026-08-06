import { response, route } from '@stacksjs/router'

/**
 * This file is the entry point for your application's API routes.
 * The routes defined here are automatically registered. Last but
 * not least, you may also create any other `routes/*.ts` files.
 *
 * Framework routes (auth, dashboard, commerce, CMS, etc.) are loaded
 * automatically from storage/framework/defaults/routes/dashboard.ts.
 * You do NOT need to define them here — only add your own custom routes.
 *
 * @see https://docs.stacksjs.com/routing
 */

// Your custom routes go here:
// Auth: the framework's /login lives in the feature-gated dashboard route
// bundle, which this app doesn't load — declare it directly.
route.post('/login', 'Actions/Auth/LoginAction').skipCsrf().rateLimit(5, 'minute')
// Single-user workspace: /register only works until the first account
// exists (overrides the open framework default).
route.post('/register', 'Actions/Postline/RegisterFirstUserAction').skipCsrf().rateLimit(3, 'minute')

// Marketing email capture. The framework action owns rate limiting, dedupe and
// the confirmation mail; this just exposes it. Unauthenticated by necessity, so
// the action's per-IP throttle is the guard.
route.post('/subscribe', 'Actions/SubscriberEmailAction').skipCsrf()

// Stripe's webhook. Unauthenticated by necessity and deliberately not rate
// limited: Stripe retries failed deliveries in bursts, and throttling those
// would drop subscription events rather than delay them. The signature check
// inside the action is the guard.
route.post('/stripe/webhook', 'Actions/Postline/StripeWebhookAction').skipCsrf()

route.get('/', () => response.text('hello world'))
route.get('/v1/status', () => response.json({ version: 'v1', status: 'ok' }))
route.get('/coming-soon', 'Controllers/ComingSoonController@index')

// Public: Instagram/Threads fetch a queued post's image server-side, so this
// route is intentionally unauthenticated. The filename is an unguessable
// per-upload UUID and strictly validated against traversal (MediaServeAction).
route.get('/postline/media', 'Actions/Postline/MediaServeAction').skipCsrf()

route.group({ prefix: '/postline/bluesky' }, () => {
  route.get('/status', 'Actions/Postline/BlueskyStatusAction').middleware('auth').skipCsrf()
  route.post('/connect', 'Actions/Postline/BlueskyConnectAction').middleware('auth').skipCsrf()
  route.post('/publish', 'Actions/Postline/BlueskyPublishAction').middleware('auth').skipCsrf()
  route.get('/link-preview', 'Actions/Postline/BlueskyLinkPreviewAction').middleware('auth').skipCsrf()
  route.get('/timeline', 'Actions/Postline/BlueskyTimelineAction').middleware('auth').skipCsrf()
})

route.group({ prefix: '/postline/linkedin' }, () => {
  route.get('/status', 'Actions/Postline/LinkedInStatusAction').middleware('auth').skipCsrf()
  route.post('/connect', 'Actions/Postline/LinkedInConnectAction').middleware('auth').skipCsrf()
  route.get('/auth', 'Actions/Postline/LinkedInAuthAction').skipCsrf()
  route.get('/callback', 'Actions/Postline/LinkedInCallbackAction').skipCsrf()
})

route.group({ prefix: '/postline/instagram' }, () => {
  route.get('/status', 'Actions/Postline/InstagramStatusAction').middleware('auth').skipCsrf()
  route.post('/connect', 'Actions/Postline/InstagramConnectAction').middleware('auth').skipCsrf()
  route.get('/auth', 'Actions/Postline/InstagramAuthAction').skipCsrf()
  route.get('/callback', 'Actions/Postline/InstagramCallbackAction').skipCsrf()
})

route.group({ prefix: '/postline/threads' }, () => {
  route.get('/status', 'Actions/Postline/ThreadsStatusAction').middleware('auth').skipCsrf()
  route.post('/connect', 'Actions/Postline/ThreadsConnectAction').middleware('auth').skipCsrf()
  route.get('/auth', 'Actions/Postline/ThreadsAuthAction').skipCsrf()
  route.get('/callback', 'Actions/Postline/ThreadsCallbackAction').skipCsrf()
})

route.group({ prefix: '/postline/twitter' }, () => {
  route.get('/status', 'Actions/Postline/TwitterStatusAction').middleware('auth').skipCsrf()
  route.post('/connect', 'Actions/Postline/TwitterConnectAction').middleware('auth').skipCsrf()
  route.get('/auth', 'Actions/Postline/TwitterAuthAction').skipCsrf()
  route.get('/callback', 'Actions/Postline/TwitterCallbackAction').skipCsrf()
})

route.group({ prefix: '/postline/mastodon' }, () => {
  route.get('/status', 'Actions/Postline/MastodonStatusAction').middleware('auth').skipCsrf()
  route.post('/connect', 'Actions/Postline/MastodonConnectAction').middleware('auth').skipCsrf()
})

route.group({ prefix: '/postline' }, () => {
  route.get('/providers', 'Actions/Postline/ProvidersStatusAction').middleware('auth').skipCsrf()
  route.post('/publish', 'Actions/Postline/CrosspostPublishAction').middleware('auth').skipCsrf()
  route.get('/analytics', 'Actions/Postline/AnalyticsAction').middleware('auth').skipCsrf()
  route.get('/blog', 'Actions/Postline/BlogListAction').middleware('auth').skipCsrf()
  route.get('/queue', 'Actions/Postline/QueueListAction').middleware('auth').skipCsrf()
  route.get('/queue/item', 'Actions/Postline/QueueGetAction').middleware('auth').skipCsrf()
  route.post('/queue', 'Actions/Postline/QueueSaveAction').middleware('auth').skipCsrf()
  route.post('/queue/update', 'Actions/Postline/QueueUpdateAction').middleware('auth').skipCsrf()
  route.post('/queue/delete', 'Actions/Postline/QueueDeleteAction').middleware('auth').skipCsrf()
  route.post('/queue/publish-now', 'Actions/Postline/QueuePublishNowAction').middleware('auth').skipCsrf()
  route.post('/metrics/sync', 'Actions/Postline/MetricsSyncAction').middleware('auth').skipCsrf()
  route.get('/campaigns', 'Actions/Postline/CampaignListAction').middleware('auth').skipCsrf()
  route.post('/campaigns', 'Actions/Postline/CampaignSaveAction').middleware('auth').skipCsrf()
  route.post('/campaigns/post', 'Actions/Postline/CampaignPostSaveAction').middleware('auth').skipCsrf()
  route.post('/campaigns/post/move', 'Actions/Postline/CampaignPostMoveAction').middleware('auth').skipCsrf()
  route.post('/campaigns/post/delete', 'Actions/Postline/CampaignPostDeleteAction').middleware('auth').skipCsrf()
  route.get('/campaigns/ai/status', 'Actions/Postline/CampaignAIStatusAction').middleware('auth').skipCsrf()
  route.post('/campaigns/generate', 'Actions/Postline/CampaignGenerateAction').middleware('auth').skipCsrf().rateLimit(10, 'hour')
  route.post('/campaigns/activate', 'Actions/Postline/CampaignActivateAction').middleware('auth').skipCsrf().rateLimit(5, 'hour')
  // Paid subscriptions. The three public routes are the reader-facing half:
  // subscribing, confirming a double opt-in, and leaving. All three are rate
  // limited per IP, since none of them can require a session.
  route.post('/subscribe', 'Actions/Postline/SubscribeAction').skipCsrf().rateLimit(10, 'minute')
  route.get('/subscribe/confirm', 'Actions/Postline/SubscriberConfirmAction').skipCsrf().rateLimit(30, 'minute')
  route.get('/subscribe/unsubscribe', 'Actions/Postline/SubscriberUnsubscribeAction').skipCsrf().rateLimit(30, 'minute')
  route.post('/checkout', 'Actions/Postline/CheckoutAction').skipCsrf().rateLimit(10, 'minute')
  route.get('/tiers', 'Actions/Postline/TiersListAction').middleware('auth').skipCsrf()
  route.post('/tiers', 'Actions/Postline/TierSaveAction').middleware('auth').skipCsrf().rateLimit(30, 'minute')
  route.post('/tiers/archive', 'Actions/Postline/TierArchiveAction').middleware('auth').skipCsrf().rateLimit(30, 'minute')
  route.get('/subscribers', 'Actions/Postline/SubscribersListAction').middleware('auth').skipCsrf()
  // The public reading surface. Unauthenticated because that is the point of a
  // publication; the paywall is enforced in the service, so a locked post
  // returns its preview rather than its body.
  route.get('/public/posts', 'Actions/Postline/PublicPostAction').skipCsrf().rateLimit(240, 'minute')

  // Import. Writes a lot of rows from one call, so it is throttled tightly.
  route.post('/import/subscribers', 'Actions/Postline/ImportSubscribersAction').middleware('auth').skipCsrf().rateLimit(10, 'hour')
  route.post('/import/posts', 'Actions/Postline/ImportPostsAction').middleware('auth').skipCsrf().rateLimit(10, 'hour')

  // Comments. Reading a thread and posting to it are public, because a reader
  // is not an account holder; posting is throttled hard, and an unknown
  // commenter is held for review rather than rejected.
  route.get('/comments', 'Actions/Postline/CommentsThreadAction').skipCsrf()
  route.post('/comments', 'Actions/Postline/CommentPostAction').skipCsrf().rateLimit(10, 'minute')
  route.get('/comments/queue', 'Actions/Postline/CommentQueueAction').middleware('auth').skipCsrf()
  route.post('/comments/moderate', 'Actions/Postline/CommentModerateAction').middleware('auth').skipCsrf().rateLimit(120, 'minute')

  route.get('/sends', 'Actions/Postline/SendsListAction').middleware('auth').skipCsrf()
  route.post('/sends', 'Actions/Postline/SendQueueAction').middleware('auth').skipCsrf().rateLimit(20, 'hour')

  // Discover. The feed read is public: it is the one surface meant to be seen
  // by people who do not have an account here, and gating it would defeat the
  // point of an index. Everything that writes stays behind auth.
  route.get('/discover', 'Actions/Postline/DiscoverFeedAction').skipCsrf()
  route.post('/discover/read', 'Actions/Postline/DiscoverReadAction').skipCsrf().rateLimit(240, 'minute')
  route.get('/publication', 'Actions/Postline/PublicationGetAction').middleware('auth').skipCsrf()
  route.post('/publication', 'Actions/Postline/PublicationSaveAction').middleware('auth').skipCsrf().rateLimit(30, 'minute')
  route.post('/discover/entry/status', 'Actions/Postline/DiscoverEntryStatusAction').middleware('auth').skipCsrf().rateLimit(60, 'minute')
  route.post('/publication/recommendations', 'Actions/Postline/RecommendationSaveAction').middleware('auth').skipCsrf().rateLimit(30, 'minute')
  route.post('/publication/recommendations/delete', 'Actions/Postline/RecommendationDeleteAction').middleware('auth').skipCsrf().rateLimit(30, 'minute')

  // Direct messages. Reads hit the local mirror and are cheap; the two calls
  // that touch a network (sync, reply) are throttled, and replying tightest —
  // it is the only one here that is visible to someone else.
  route.get('/inbox', 'Actions/Postline/InboxListAction').middleware('auth').skipCsrf()
  route.get('/inbox/thread', 'Actions/Postline/InboxThreadAction').middleware('auth').skipCsrf()
  route.post('/inbox/sync', 'Actions/Postline/InboxSyncAction').middleware('auth').skipCsrf().rateLimit(60, 'hour')
  route.post('/inbox/reply', 'Actions/Postline/InboxReplyAction').middleware('auth').skipCsrf().rateLimit(60, 'hour')
  route.post('/inbox/read', 'Actions/Postline/InboxReadAction').middleware('auth').skipCsrf().rateLimit(120, 'minute')
  route.post('/inbox/archive', 'Actions/Postline/InboxArchiveAction').middleware('auth').skipCsrf().rateLimit(60, 'minute')
  route.get('/listening', 'Actions/Postline/KeywordMonitorListAction').middleware('auth').skipCsrf()
  route.post('/listening', 'Actions/Postline/KeywordMonitorSaveAction').middleware('auth').skipCsrf().rateLimit(30, 'minute')
  route.post('/listening/delete', 'Actions/Postline/KeywordMonitorDeleteAction').middleware('auth').skipCsrf().rateLimit(20, 'minute')
  route.post('/listening/scan', 'Actions/Postline/KeywordMonitorScanAction').middleware('auth').skipCsrf().rateLimit(20, 'hour')
  route.post('/listening/read', 'Actions/Postline/KeywordMentionReadAction').middleware('auth').skipCsrf().rateLimit(120, 'minute')
  // Bulk post deletion. Irreversible, so both halves are auth-only and rate
  // limited — the preview generously, the destructive run tightly.
  route.get('/purge/preview', 'Actions/Postline/PurgePreviewAction').middleware('auth').skipCsrf().rateLimit(20, 'minute')
  route.post('/purge', 'Actions/Postline/PurgeRunAction').middleware('auth').skipCsrf().rateLimit(3, 'hour')
})
