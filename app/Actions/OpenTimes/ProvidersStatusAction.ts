import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { blog } from '../../Services/Social/BlogService'
import { bluesky } from '../../Services/Social/BlueskyService'
import { instagram } from '../../Services/Social/InstagramService'
import { linkedin } from '../../Services/Social/LinkedInService'
import { mastodon } from '../../Services/Social/MastodonService'
import { opentimes } from '../../Services/Social/OpenTimesService'
import { threads } from '../../Services/Social/ThreadsService'
import { twitter } from '../../Services/Social/TwitterService'

export default new Action({
  name: 'The Open Times Providers Status',
  description: 'Return the connection state for every crosspost provider and its accounts.',
  method: 'GET',

  async handle() {
    try {
      const providers = await Promise.all([
        // Ours leads the list, which is also the order the composer renders
        // its chips in and therefore what gets selected first by default.
        opentimes.status(),
        bluesky.status(),
        twitter.status(),
        linkedin.status(),
        instagram.status(),
        threads.status(),
        mastodon.status(),
        blog.status(),
      ])

      // Each network entry keeps its single-account fields (the default
      // account) and carries `accounts` with every connected one; the flat
      // list is for callers that render per account rather than per network.
      const accounts = providers.flatMap(status => 'accounts' in status ? status.accounts : [])

      return response.json({ ok: true, data: { providers, accounts } })
    }
    catch (error) {
      return response.json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, { status: 500 })
    }
  },
})
