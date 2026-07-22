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

route.get('/', () => response.text('hello world'))
route.get('/coming-soon', 'Controllers/ComingSoonController@index')

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
})
