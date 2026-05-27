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
route.get('/', () => response.text('hello world'))
route.get('/coming-soon', 'Controllers/ComingSoonController@index')

route.group({ prefix: '/postline/bluesky' }, () => {
  route.get('/status', 'Actions/Postline/BlueskyStatusAction').skipCsrf()
  route.post('/connect', 'Actions/Postline/BlueskyConnectAction').skipCsrf()
  route.post('/publish', 'Actions/Postline/BlueskyPublishAction').skipCsrf()
  route.get('/link-preview', 'Actions/Postline/BlueskyLinkPreviewAction').skipCsrf()
  route.get('/timeline', 'Actions/Postline/BlueskyTimelineAction').skipCsrf()
})

route.group({ prefix: '/postline/linkedin' }, () => {
  route.get('/status', 'Actions/Postline/LinkedInStatusAction').skipCsrf()
  route.post('/connect', 'Actions/Postline/LinkedInConnectAction').skipCsrf()
  route.get('/auth', 'Actions/Postline/LinkedInAuthAction').skipCsrf()
  route.get('/callback', 'Actions/Postline/LinkedInCallbackAction').skipCsrf()
})

route.group({ prefix: '/postline/instagram' }, () => {
  route.get('/status', 'Actions/Postline/InstagramStatusAction').skipCsrf()
  route.post('/connect', 'Actions/Postline/InstagramConnectAction').skipCsrf()
  route.get('/auth', 'Actions/Postline/InstagramAuthAction').skipCsrf()
  route.get('/callback', 'Actions/Postline/InstagramCallbackAction').skipCsrf()
})

route.group({ prefix: '/postline' }, () => {
  route.get('/providers', 'Actions/Postline/ProvidersStatusAction').skipCsrf()
  route.post('/publish', 'Actions/Postline/CrosspostPublishAction').skipCsrf()
})
