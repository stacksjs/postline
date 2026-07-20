/**
 * Route Registry
 *
 * Self-contained now that the framework is a node_modules dependency (there
 * is no vendored `storage/framework/defaults/app/Routes` to re-export). The
 * key becomes the URL prefix: `api` auto-prefixes with `/api` so
 * `routes/api.ts` lines up with the rpx proxy forward path.
 *
 * @see https://docs.stacksjs.org/routing
 */
import type { RouteRegistry } from '@stacksjs/router'

export type { RouteDefinition, RouteRegistry } from '@stacksjs/router'

export default {
  // Postline's real API surface (auth + /postline/*) lives in routes/api.ts,
  // auto-prefixed with /api.
  'api': 'api',

  // Versioned demo routes.
  'v1': { path: 'v1', prefix: 'v1' },
} satisfies RouteRegistry
