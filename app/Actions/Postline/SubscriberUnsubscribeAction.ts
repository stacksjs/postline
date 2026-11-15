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
 * The one-click unsubscribe from a mail footer. Answers with a page for the
 * same reason confirmation does, and never asks the reader to log in or to
 * confirm twice: an unsubscribe that takes two clicks is a dark pattern.
 */
export default new Action({
  name: 'Postline Subscriber Unsubscribe',
  description: 'One-click unsubscribe from a mail footer.',
  method: 'GET',

  async handle(request: RequestInstance) {
    try {
      const result = await subscribers.unsubscribe(String(request.get('token') || ''))

      return htmlResponse(readerPage({
        title: 'Unsubscribed',
        message: `${result.email} will not receive any more posts. You can subscribe again whenever you like.`,
        action: { href: '/read', label: 'Go to the publication' },
      }))
    }
    catch (error) {
      return htmlResponse(readerPage({
        title: 'That link did not work',
        message: error instanceof Error ? error.message : String(error),
        tone: 'error',
      }), 400)
    }
  },
})
