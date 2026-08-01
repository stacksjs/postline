import type { DnsConfig } from '@stacksjs/types'
import { env } from '@stacksjs/env'

/**
 * **DNS Options**
 *
 * This configuration defines all of your DNS options. Because Stacks is fully-typed, you
 * may hover any of the options below and the definitions will be provided. In case you
 * have any questions, feel free to reach out via Discord or GitHub Discussions.
 */
export default {
  /**
   * The A record for this app's own subdomain is NOT declared here: `buddy
   * deploy` reconciles it from `sites.main.domain` in config/cloud.ts against
   * the box it actually deployed to, so hardcoding an address would just go
   * stale the first time the server moves.
   *
   * The scaffold shipped `{ name: env.APP_URL, address: '10.0.0.1' }` here,
   * which wrote a literal `postline.localhost.stacksjs.com → 10.0.0.1` into the
   * live zone, plus a `www` record this app does not own.
   */
  a: [],
  aaaa: [],
  cname: [],
  mx: [],
  txt: [],

  nameservers: ['ns-1731.awsdns-24.co.uk', 'ns-355.awsdns-44.com', 'ns-536.awsdns-03.net', 'ns-1395.awsdns-46.org'],

  // redirects: ['stacksjs.com', 'buddy.sh'],
} satisfies DnsConfig
