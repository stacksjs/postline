import type { ServerConfig } from '@stacksjs/types'
import { marketingRedirects } from '../app/Support/Marketing/site'

/**
 * **Server Configuration**
 *
 * The largest things Postline accepts are a post with four images of up to
 * 10 MB each (`app/Support/Social/image-input.ts`) and a workspace import,
 * whose images travel inside it. 64 MB covers both with room for the form
 * around them; it was 12 MB, which refused a post with two large images.
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
    csp: true,
  },
} satisfies ServerConfig
