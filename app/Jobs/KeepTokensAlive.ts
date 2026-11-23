import { log } from '@stacksjs/logging'
import { Job } from '@stacksjs/queue'
import { Every } from '@stacksjs/types'
import { linkedin } from '../Services/Social/LinkedInService'
import { threads } from '../Services/Social/ThreadsService'
import { withHeartbeat } from '../Support/heartbeat'
import { twitter } from '../Services/Social/TwitterService'

/**
 * Tokens were only renewed while publishing, so an account nobody posted from
 * for two months quietly lapsed. This renews any that are close to expiry,
 * and an account whose renewal the network refuses is marked as needing a
 * reconnect, which Channels shows before a post fails.
 */
export default new Job({
  name: 'KeepTokensAlive',
  description: 'Renew network tokens that are close to expiry.',
  queue: 'default',
  tries: 1,
  backoff: 10,
  rate: Every.Day,

  handle: async () => await withHeartbeat('KeepTokensAlive', async () => {
    const renewed: Record<string, number> = {}
    for (const [name, service] of Object.entries({ twitter, linkedin, threads })) {
      try {
        renewed[name] = await service.keepAlive()
      }
      catch (error) {
        // One network being down must not stop the others being renewed.
        log.error(`[postline] token keepalive failed for ${name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const total = Object.values(renewed).reduce((sum, count) => sum + count, 0)
    if (total) log.info(`[postline] token keepalive: renewed ${total} token(s)`)
    return renewed
  }),
})
