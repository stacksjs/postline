import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { blog } from '../../Services/Social/BlogService'
import { bluesky } from '../../Services/Social/BlueskyService'
import { instagram } from '../../Services/Social/InstagramService'
import { linkedin } from '../../Services/Social/LinkedInService'
import { mastodon } from '../../Services/Social/MastodonService'
import { postline } from '../../Services/Social/PostlineService'
import { threads } from '../../Services/Social/ThreadsService'
import { twitter } from '../../Services/Social/TwitterService'

export default new Action({
  name: 'Postline Providers Status',
  description: 'Return the connection state for every crosspost provider.',
  method: 'GET',

  async handle() {
    try {
      const providers = await Promise.all([
        // Ours leads the list, which is also the order the composer renders
        // its chips in and therefore what gets selected first by default.
        postline.status(),
        bluesky.status(),
        twitter.status(),
        linkedin.status(),
        instagram.status(),
        threads.status(),
        mastodon.status(),
        blog.status(),
      ])

      return response.json({ ok: true, data: { providers } })
    }
    catch (error) {
      return response.json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, { status: 500 })
    }
  },
})
