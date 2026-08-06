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
route.post('/register', 'Actions/OpenTimes/RegisterFirstUserAction').skipCsrf().rateLimit(3, 'minute')

// Marketing email capture. The framework action owns rate limiting, dedupe and
// the confirmation mail; this just exposes it. Unauthenticated by necessity, so
// the action's per-IP throttle is the guard.
route.post('/subscribe', 'Actions/SubscriberEmailAction').skipCsrf()

// Stripe's webhook. Unauthenticated by necessity and deliberately not rate
// limited: Stripe retries failed deliveries in bursts, and throttling those
// would drop subscription events rather than delay them. The signature check
// inside the action is the guard.
route.post('/stripe/webhook', 'Actions/OpenTimes/StripeWebhookAction').skipCsrf()

route.get('/', () => response.text('hello world'))
route.get('/v1/status', () => response.json({ version: 'v1', status: 'ok' }))
route.get('/coming-soon', 'Controllers/ComingSoonController@index')

// Public: Instagram/Threads fetch a queued post's image server-side, so this
// route is intentionally unauthenticated. The filename is an unguessable
// per-upload UUID and strictly validated against traversal (MediaServeAction).
route.get('/ot/media', 'Actions/OpenTimes/MediaServeAction').skipCsrf()

route.group({ prefix: '/ot/bluesky' }, () => {
  route.get('/status', 'Actions/OpenTimes/BlueskyStatusAction').middleware('auth').skipCsrf()
  route.post('/connect', 'Actions/OpenTimes/BlueskyConnectAction').middleware('auth').skipCsrf()
  route.post('/publish', 'Actions/OpenTimes/BlueskyPublishAction').middleware('auth').skipCsrf()
  route.get('/link-preview', 'Actions/OpenTimes/BlueskyLinkPreviewAction').middleware('auth').skipCsrf()
  route.get('/timeline', 'Actions/OpenTimes/BlueskyTimelineAction').middleware('auth').skipCsrf()
})

route.group({ prefix: '/ot/linkedin' }, () => {
  route.get('/status', 'Actions/OpenTimes/LinkedInStatusAction').middleware('auth').skipCsrf()
  route.post('/connect', 'Actions/OpenTimes/LinkedInConnectAction').middleware('auth').skipCsrf()
  route.get('/auth', 'Actions/OpenTimes/LinkedInAuthAction').skipCsrf()
  route.get('/callback', 'Actions/OpenTimes/LinkedInCallbackAction').skipCsrf()
})

route.group({ prefix: '/ot/instagram' }, () => {
  route.get('/status', 'Actions/OpenTimes/InstagramStatusAction').middleware('auth').skipCsrf()
  route.post('/connect', 'Actions/OpenTimes/InstagramConnectAction').middleware('auth').skipCsrf()
  route.get('/auth', 'Actions/OpenTimes/InstagramAuthAction').skipCsrf()
  route.get('/callback', 'Actions/OpenTimes/InstagramCallbackAction').skipCsrf()
})

route.group({ prefix: '/ot/threads' }, () => {
  route.get('/status', 'Actions/OpenTimes/ThreadsStatusAction').middleware('auth').skipCsrf()
  route.post('/connect', 'Actions/OpenTimes/ThreadsConnectAction').middleware('auth').skipCsrf()
  route.get('/auth', 'Actions/OpenTimes/ThreadsAuthAction').skipCsrf()
  route.get('/callback', 'Actions/OpenTimes/ThreadsCallbackAction').skipCsrf()
})

route.group({ prefix: '/ot/twitter' }, () => {
  route.get('/status', 'Actions/OpenTimes/TwitterStatusAction').middleware('auth').skipCsrf()
  route.post('/connect', 'Actions/OpenTimes/TwitterConnectAction').middleware('auth').skipCsrf()
  route.get('/auth', 'Actions/OpenTimes/TwitterAuthAction').skipCsrf()
  route.get('/callback', 'Actions/OpenTimes/TwitterCallbackAction').skipCsrf()
})

route.group({ prefix: '/ot/mastodon' }, () => {
  route.get('/status', 'Actions/OpenTimes/MastodonStatusAction').middleware('auth').skipCsrf()
  route.post('/connect', 'Actions/OpenTimes/MastodonConnectAction').middleware('auth').skipCsrf()
})

route.group({ prefix: '/ot' }, () => {
  route.get('/providers', 'Actions/OpenTimes/ProvidersStatusAction').middleware('auth').skipCsrf()
  route.post('/publish', 'Actions/OpenTimes/CrosspostPublishAction').middleware('auth').skipCsrf()
  route.get('/analytics', 'Actions/OpenTimes/AnalyticsAction').middleware('auth').skipCsrf()
  route.get('/blog', 'Actions/OpenTimes/BlogListAction').middleware('auth').skipCsrf()
  route.get('/queue', 'Actions/OpenTimes/QueueListAction').middleware('auth').skipCsrf()
  route.get('/queue/item', 'Actions/OpenTimes/QueueGetAction').middleware('auth').skipCsrf()
  route.post('/queue', 'Actions/OpenTimes/QueueSaveAction').middleware('auth').skipCsrf()
  route.post('/queue/update', 'Actions/OpenTimes/QueueUpdateAction').middleware('auth').skipCsrf()
  route.post('/queue/delete', 'Actions/OpenTimes/QueueDeleteAction').middleware('auth').skipCsrf()
  route.post('/queue/publish-now', 'Actions/OpenTimes/QueuePublishNowAction').middleware('auth').skipCsrf()
  route.post('/metrics/sync', 'Actions/OpenTimes/MetricsSyncAction').middleware('auth').skipCsrf()
  route.get('/campaigns', 'Actions/OpenTimes/CampaignListAction').middleware('auth').skipCsrf()
  route.post('/campaigns', 'Actions/OpenTimes/CampaignSaveAction').middleware('auth').skipCsrf()
  route.post('/campaigns/post', 'Actions/OpenTimes/CampaignPostSaveAction').middleware('auth').skipCsrf()
  route.post('/campaigns/post/move', 'Actions/OpenTimes/CampaignPostMoveAction').middleware('auth').skipCsrf()
  route.post('/campaigns/post/delete', 'Actions/OpenTimes/CampaignPostDeleteAction').middleware('auth').skipCsrf()
  route.get('/campaigns/ai/status', 'Actions/OpenTimes/CampaignAIStatusAction').middleware('auth').skipCsrf()
  route.post('/campaigns/generate', 'Actions/OpenTimes/CampaignGenerateAction').middleware('auth').skipCsrf().rateLimit(10, 'hour')
  route.post('/campaigns/activate', 'Actions/OpenTimes/CampaignActivateAction').middleware('auth').skipCsrf().rateLimit(5, 'hour')
  // Paid subscriptions. The three public routes are the reader-facing half:
  // subscribing, confirming a double opt-in, and leaving. All three are rate
  // limited per IP, since none of them can require a session.
  route.post('/subscribe', 'Actions/OpenTimes/SubscribeAction').skipCsrf().rateLimit(10, 'minute')
  route.get('/subscribe/confirm', 'Actions/OpenTimes/SubscriberConfirmAction').skipCsrf().rateLimit(30, 'minute')
  route.get('/subscribe/unsubscribe', 'Actions/OpenTimes/SubscriberUnsubscribeAction').skipCsrf().rateLimit(30, 'minute')
  route.post('/checkout', 'Actions/OpenTimes/CheckoutAction').skipCsrf().rateLimit(10, 'minute')
  route.get('/tiers', 'Actions/OpenTimes/TiersListAction').middleware('auth').skipCsrf()
  route.post('/tiers', 'Actions/OpenTimes/TierSaveAction').middleware('auth').skipCsrf().rateLimit(30, 'minute')
  route.post('/tiers/archive', 'Actions/OpenTimes/TierArchiveAction').middleware('auth').skipCsrf().rateLimit(30, 'minute')
  route.get('/subscribers', 'Actions/OpenTimes/SubscribersListAction').middleware('auth').skipCsrf()
  // The public reading surface. Unauthenticated because that is the point of a
  // publication; the paywall is enforced in the service, so a locked post
  // returns its preview rather than its body.
  route.get('/public/posts', 'Actions/OpenTimes/PublicPostAction').skipCsrf().rateLimit(240, 'minute')

  // Import. Writes a lot of rows from one call, so it is throttled tightly.
  route.post('/import/subscribers', 'Actions/OpenTimes/ImportSubscribersAction').middleware('auth').skipCsrf().rateLimit(10, 'hour')
  route.post('/import/posts', 'Actions/OpenTimes/ImportPostsAction').middleware('auth').skipCsrf().rateLimit(10, 'hour')

  // Comments. Reading a thread and posting to it are public, because a reader
  // is not an account holder; posting is throttled hard, and an unknown
  // commenter is held for review rather than rejected.
  route.get('/comments', 'Actions/OpenTimes/CommentsThreadAction').skipCsrf()
  route.post('/comments', 'Actions/OpenTimes/CommentPostAction').skipCsrf().rateLimit(10, 'minute')
  route.get('/comments/queue', 'Actions/OpenTimes/CommentQueueAction').middleware('auth').skipCsrf()
  route.post('/comments/moderate', 'Actions/OpenTimes/CommentModerateAction').middleware('auth').skipCsrf().rateLimit(120, 'minute')

  route.get('/sends', 'Actions/OpenTimes/SendsListAction').middleware('auth').skipCsrf()
  route.post('/sends', 'Actions/OpenTimes/SendQueueAction').middleware('auth').skipCsrf().rateLimit(20, 'hour')

  // Discover. The feed read is public: it is the one surface meant to be seen
  // by people who do not have an account here, and gating it would defeat the
  // point of an index. Everything that writes stays behind auth.
  route.get('/discover', 'Actions/OpenTimes/DiscoverFeedAction').skipCsrf()
  route.post('/discover/read', 'Actions/OpenTimes/DiscoverReadAction').skipCsrf().rateLimit(240, 'minute')
  route.get('/publication', 'Actions/OpenTimes/PublicationGetAction').middleware('auth').skipCsrf()
  route.post('/publication', 'Actions/OpenTimes/PublicationSaveAction').middleware('auth').skipCsrf().rateLimit(30, 'minute')
  route.post('/discover/entry/status', 'Actions/OpenTimes/DiscoverEntryStatusAction').middleware('auth').skipCsrf().rateLimit(60, 'minute')
  route.post('/publication/recommendations', 'Actions/OpenTimes/RecommendationSaveAction').middleware('auth').skipCsrf().rateLimit(30, 'minute')
  route.post('/publication/recommendations/delete', 'Actions/OpenTimes/RecommendationDeleteAction').middleware('auth').skipCsrf().rateLimit(30, 'minute')

  // Direct messages. Reads hit the local mirror and are cheap; the two calls
  // that touch a network (sync, reply) are throttled, and replying tightest —
  // it is the only one here that is visible to someone else.
  route.get('/inbox', 'Actions/OpenTimes/InboxListAction').middleware('auth').skipCsrf()
  route.get('/inbox/thread', 'Actions/OpenTimes/InboxThreadAction').middleware('auth').skipCsrf()
  route.post('/inbox/sync', 'Actions/OpenTimes/InboxSyncAction').middleware('auth').skipCsrf().rateLimit(60, 'hour')
  route.post('/inbox/reply', 'Actions/OpenTimes/InboxReplyAction').middleware('auth').skipCsrf().rateLimit(60, 'hour')
  route.post('/inbox/read', 'Actions/OpenTimes/InboxReadAction').middleware('auth').skipCsrf().rateLimit(120, 'minute')
  route.post('/inbox/archive', 'Actions/OpenTimes/InboxArchiveAction').middleware('auth').skipCsrf().rateLimit(60, 'minute')
  route.get('/listening', 'Actions/OpenTimes/KeywordMonitorListAction').middleware('auth').skipCsrf()
  route.post('/listening', 'Actions/OpenTimes/KeywordMonitorSaveAction').middleware('auth').skipCsrf().rateLimit(30, 'minute')
  route.post('/listening/delete', 'Actions/OpenTimes/KeywordMonitorDeleteAction').middleware('auth').skipCsrf().rateLimit(20, 'minute')
  route.post('/listening/scan', 'Actions/OpenTimes/KeywordMonitorScanAction').middleware('auth').skipCsrf().rateLimit(20, 'hour')
  route.post('/listening/read', 'Actions/OpenTimes/KeywordMentionReadAction').middleware('auth').skipCsrf().rateLimit(120, 'minute')
  // Bulk post deletion. Irreversible, so both halves are auth-only and rate
  // limited — the preview generously, the destructive run tightly.
  route.get('/purge/preview', 'Actions/OpenTimes/PurgePreviewAction').middleware('auth').skipCsrf().rateLimit(20, 'minute')
  route.post('/purge', 'Actions/OpenTimes/PurgeRunAction').middleware('auth').skipCsrf().rateLimit(3, 'hour')
})
