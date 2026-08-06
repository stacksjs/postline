import type { AppConfig } from '@stacksjs/types'
import { canonical, LOCAL_HOST } from '~/config/domains'
import { env } from '@stacksjs/env'

type OpenTimesAppConfig = AppConfig & { appPath: string, devLaunch: 'native' }

/**
 * **Application Configuration**
 *
 * This configuration defines all of your application options. Because Stacks is fully-typed,
 * you may hover any of the options below and the definitions will be provided. In case
 * you have any questions, feel free to reach out via Discord or GitHub Discussions.
 */
export default {
  name: env.APP_NAME ?? 'The Open Times',
  description: 'An independent newspaper you own — write it, send it, syndicate it, and keep the list.',
  env: env.APP_ENV ?? 'local',
  /**
   * `APP_URL` is the dev host; deployed environments set it to the canonical
   * domain. The fallback resolves through config/domains.ts rather than being
   * spelled out, so `buddy domain:use` moves this too.
   */
  url: env.APP_URL ?? (env.APP_ENV === 'local' ? LOCAL_HOST : canonical),
  appPath: '/composer',
  devLaunch: 'native',
  redirectUrls: [LOCAL_HOST, canonical, 'bsky.app'],
  debug: env.DEBUG ?? false,
  key: env.APP_KEY,

  maintenanceMode: env.APP_MAINTENANCE ?? false,
  comingSoonMode: env.APP_COMING_SOON ?? false,
  comingSoonSecret: env.APP_COMING_SOON_SECRET ?? '',
  // docMode: true, // instead of example.com/docs, deploys example.com as main entry point for docs
  docMode: false,

  timezone: 'America/Los_Angeles',
  locale: 'en',
  fallbackLocale: 'en',
  cipher: 'aes-256-cbc',
} satisfies OpenTimesAppConfig
