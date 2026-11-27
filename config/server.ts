import type { ServerConfig } from '@stacksjs/types'
import { marketingRedirects } from '../app/Support/Marketing/site'

/**
 * **Server Configuration**
 *
 * A post can attach four 10 MiB images or one MP4 up to 40 MiB. The request
 * limit leaves room for multipart framing and base64-encoded workspace
 * attachments during import.
 * Without a limit the runtime's default applies, which is 128 MB per request.
 */
export default {
  maxRequestBodySize: 64 * 1024 * 1024,

  // A self-hosted install opens the workspace at `/`. The marketing pages are
  // served only by the deployment started with POSTLINE_SITE=marketing; on any
  // other they redirect to the workspace (app/Support/Marketing/site.ts).
  redirects: marketingRedirects(),

  // Headers on every rendered page: HSTS on a real https host, an opener
  // policy that still lets OAuth popups report back, and a permissions policy.
  // STX precompiles bindings so nonce-authorized scripts run without eval.
  security: {
    csp: { directives: { 'media-src': ["'self'", 'blob:'] } },
  },
} satisfies ServerConfig
