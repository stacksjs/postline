import type { AnalyticsConfig } from '@stacksjs/types'

/**
 * **Analytics Configuration**
 *
 * This configuration defines all of your Analytics options. Because Stacks is fully-typed,
 * you may hover any of the options below and the definitions will be provided. In case
 * you have any questions, feel free to reach out via Discord or GitHub Discussions.
 */
// No analytics. The scaffold shipped a Fathom site id (the framework's own),
// so switching analytics on would have reported every install's visits to
// someone else's account (#68). An id goes here only when the marketing site
// gets an analytics account of its own, and the privacy page says so first.
export default {
  driver: 'fathom',

  drivers: {
    fathom: {
      siteId: '',
    },
  },
} satisfies AnalyticsConfig
