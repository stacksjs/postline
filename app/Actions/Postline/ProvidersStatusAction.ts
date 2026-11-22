import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { blog } from '../../Services/Social/BlogService'
import { bluesky } from '../../Services/Social/BlueskyService'
import { instagram } from '../../Services/Social/InstagramService'
import { linkedin } from '../../Services/Social/LinkedInService'
import { mastodon } from '../../Services/Social/MastodonService'
import { threads } from '../../Services/Social/ThreadsService'
import { twitter } from '../../Services/Social/TwitterService'

export default new Action({
  name: 'Postline Providers Status',
  description: 'Return the connection state for every crosspost provider and its accounts.',
  method: 'GET',

  async handle() {
    try {
      const providers = await Promise.all([
        // This is also the order the composer renders its chips in.
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
      return actionFailure(error, 500)
    }
  },
})
