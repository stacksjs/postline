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
} satisfies ServerConfig
