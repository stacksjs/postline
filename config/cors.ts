import type { CorsConfig } from '@stacksjs/types'
import { env } from '@stacksjs/env'

/**
 * **CORS Configuration**
 *
 * Postline's pages and its API share one origin, so the browser never needs
 * permission to call the API from the app itself. The only thing a CORS
 * policy can do here is let *other* sites read API responses, and nothing
 * should. The framework default is `origin: '*'`; this narrows it to the
 * app's own address.
 */
function ownOrigins(): string[] {
  const url = String(env.APP_URL || '').trim()
  if (!url)
    return []

  if (/^https?:\/\//i.test(url))
    return [new URL(url).origin]

  // `APP_URL` is often a bare host (`postline.localhost`).
  return [`https://${url}`, `http://${url}`]
}

export default {
  origin: ownOrigins(),
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Requested-With'],
  maxAge: 600,
} satisfies CorsConfig
