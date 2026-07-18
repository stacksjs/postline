import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { blog } from '../../Services/Social/BlogService'
import { bluesky } from '../../Services/Social/BlueskyService'
import { instagram } from '../../Services/Social/InstagramService'
import { linkedin } from '../../Services/Social/LinkedInService'
import { threads } from '../../Services/Social/ThreadsService'

export default new Action({
  name: 'Postline Providers Status',
  description: 'Return the connection state for every crosspost provider.',
  method: 'GET',

  async handle() {
    try {
      const providers = await Promise.all([
        bluesky.status(),
        linkedin.status(),
        instagram.status(),
        threads.status(),
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
