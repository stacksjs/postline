import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { readerPage } from '../../Support/Mail/reader-page'
import { subscribers } from '../../Services/SubscriberService'

/**
 * `response.html` is documented in @stacksjs/router but does not exist on the
 * factory at runtime, and `response.text` hard-codes text/plain, which a
 * browser then renders as source. So this returns a Response directly. Worth
 * fixing upstream: the doc comment lists a method that was never shipped.
 */
function htmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

/**
 * Reached by clicking a link in an email, so it answers with a page rather
 * than JSON. A reader who confirms should see a sentence, not a response body.
 */
export default new Action({
  name: 'Postline Subscriber Confirm',
  description: 'Confirm a double opt-in subscription.',
  method: 'GET',

  async handle(request: RequestInstance) {
    try {
      const subscriber = await subscribers.confirm(String(request.get('token') || ''))

      return htmlResponse(readerPage({
        title: 'You are subscribed',
        message: `${subscriber.email} is confirmed. The next post will arrive in your inbox.`,
        action: { href: '/read', label: 'Read the archive' },
      }))
    }
    catch (error) {
      return htmlResponse(readerPage({
        title: 'That link did not work',
        message: error instanceof Error ? error.message : String(error),
        action: { href: '/read', label: 'Go to the publication' },
        tone: 'error',
      }), 400)
    }
  },
})
