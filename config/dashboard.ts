import type { DashboardConfig } from '@stacksjs/types'

/**
 * **Dashboard Configuration**
 *
 * `enabled` gates the whole bundled dashboard surface: the
 * `buddy dev --dashboard` sidebar AND the framework's bundled dashboard
 * routes (auth, password reset, email subscribe, storefront, reviews,
 * sitemap, AI/voice, and the admin REST API — registered from
 * `storage/framework/defaults/routes/dashboard.ts`).
 *
 * Set `enabled: false` if this project ships its own routes (see
 * `routes/api.ts`) and doesn't need the bundled surface — that skips
 * registering ~hundreds of routes at boot (~50ms faster `./buddy dev`).
 * No routes are lost: the framework still ships them, they're just not
 * loaded here. Leave it `true` to keep them.
 *
 * `sections` then controls which sidebar sections render when the
 * dashboard is enabled. Each section defaults to enabled — flip a flag to
 * `false` to hide a section this project doesn't use. Common cases:
 *
 *   • A non-commerce app removes the Commerce section (and its categorized
 *     model rows) by setting `commerce.enabled: false`.
 *
 *   • A project with no newsletter hides the built-in Subscribers row in
 *     the Data section by setting `data.subscribers.enabled: false`. The
 *     Data section itself stays — that's where every userland model under
 *     `app/Models/` is auto-listed, and you always want to see those.
 */
export default {
  // Bundled dashboard routes + sidebar. Flip to `false` to skip the
  // bundled route registration at boot (this app defines its own routes).
  enabled: true,
  sections: {
    library: { enabled: true },
    content: { enabled: true },
    commerce: { enabled: true },
    marketing: { enabled: true },
    analytics: { enabled: true },
    management: { enabled: true },
    utilities: { enabled: true },
    data: {
      // Basic built-in rows. Disable any you don't need; your userland
      // models in `app/Models/` always appear regardless of these flags.
      dashboard: { enabled: true },
      activity: { enabled: true },
      users: { enabled: true },
      teams: { enabled: true },
      subscribers: { enabled: true },
      allModels: { enabled: true },
    },
  },
} satisfies DashboardConfig
