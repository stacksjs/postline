import type { ServerConfig } from '@stacksjs/types'

/**
 * **Server Configuration**
 *
 * The largest thing Postline accepts is one image attached to a post, capped
 * at 10 MB in `app/Support/Social/image-input.ts`. The limit here leaves room
 * for the rest of the multipart form around it. Without it the runtime's
 * default applies, which is 128 MB per request.
 */
export default {
  maxRequestBodySize: 12 * 1024 * 1024,

  // Headers on every rendered page: HSTS on a real https host, an opener
  // policy that still lets OAuth popups report back, and a permissions policy.
  // The Content-Security-Policy only reports for now, so the browser console
  // shows what enforcing it would break before it is switched on (#90).
  security: {
    csp: 'report-only',
  },
} satisfies ServerConfig
