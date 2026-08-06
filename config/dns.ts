import type { DnsConfig } from '@stacksjs/types'
import { redirects } from '~/config/domains'

/**
 * **DNS Options**
 *
 * This configuration defines all of your DNS options. Because Stacks is fully-typed, you
 * may hover any of the options below and the definitions will be provided. In case you
 * have any questions, feel free to reach out via Discord or GitHub Discussions.
 *
 * WHERE THE ZONES ACTUALLY LIVE
 *
 * theopentimes.org, theot.org, theot.app and theot.blog are registered at
 * Porkbun, and Porkbun serves their DNS. ts-cloud picks that provider up on its
 * own from `PORKBUN_API_KEY` / `PORKBUN_SECRET_KEY` (see `loadFromEnv` in its
 * DNS registry) and asks each configured provider which domain it can manage —
 * so there is no driver to name here. The `nameservers` below belong to the
 * legacy stacksjs.com zone in Route53, which still hosts the
 * `opentimes.stacksjs.com` subdomain.
 */
export default {
  /**
   * Address records are NOT declared here: `buddy deploy` reconciles them from
   * `sites.*.domain` in config/cloud.ts against the box it actually deployed
   * to, so hardcoding an address would just go stale the first time the server
   * moves.
   *
   * The scaffold shipped `{ name: env.APP_URL, address: '10.0.0.1' }` here,
   * which wrote a literal `<app-url>.stacksjs.com → 10.0.0.1` into the live
   * zone, plus a `www` record this app does not own.
   */
  a: [],
  aaaa: [],
  cname: [],
  mx: [],
  txt: [],

  nameservers: ['ns-1731.awsdns-24.co.uk', 'ns-355.awsdns-44.com', 'ns-536.awsdns-03.net', 'ns-1395.awsdns-46.org'],

  /**
   * Hosts that resolve to the box but only ever answer with a 301. Derived from
   * config/domains.ts rather than listed, so this can never fall out of step
   * with the canonical host — flipping `DOMAIN_MODE` moves whichever host just
   * stopped being canonical into this list automatically.
   */
  redirects: [...redirects],
} satisfies DnsConfig
