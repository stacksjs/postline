/**
 * The broadcast server process.
 *
 * The Open Times' realtime surfaces (the Discover feeds, comment threads) publish
 * through `@stacksjs/realtime`, which is the framework's integration over
 * ts-broadcasting. Publishing is a no-op until a server exists to publish
 * *to*: `emit` warns and returns when none is running, which is the right
 * behaviour for a web request but means the feature is dormant until this
 * process is up.
 *
 * Run it alongside the app:
 *
 *   bun app/Broadcast/server.ts
 *
 * In production it is a site in `config/cloud.ts`, so systemd runs it and rpx
 * proxies it. Browsers reach it over the app's own certificate rather than a
 * raw port, which matters because a page served over https cannot open a `ws:`
 * connection at all.
 *
 * Channels are public. Discover only carries entries from publications that
 * opted into being indexed, and a comment thread is already readable by anyone
 * who can read the post, so there is nothing here to authorize. A private
 * channel would imply a permission check that does not exist.
 */

import process from 'node:process'
import { createServer, setServer } from '@stacksjs/realtime'

const host = String(process.env.BROADCAST_HOST || '0.0.0.0')
const port = Number(process.env.BROADCAST_PORT || 6001)

/**
 * Redis is what connects this process to the app's.
 *
 * The web process handles the request that publishes a post; this one holds
 * the sockets. They are separate systemd services in production, so the app
 * publishes to Redis and this server relays to its clients. Without it the two
 * halves cannot see each other and every event is dropped silently.
 *
 * Opt-in, matching the app side: a single-process dev machine needs none of
 * this, and turning the cache's Redis into realtime fan-out without being
 * asked would be surprising.
 */
const relayEnabled = ['1', 'true'].includes(String(process.env.BROADCAST_REDIS_ENABLED || '').toLowerCase())
const redis = relayEnabled
  ? {
      host: String(process.env.REDIS_HOST || 'localhost'),
      port: Number(process.env.REDIS_PORT || 6379),
      password: String(process.env.REDIS_PASSWORD || '') || undefined,
      keyPrefix: String(process.env.BROADCAST_REDIS_PREFIX || 'opentimes:realtime:'),
    }
  : undefined

const server = await createServer({
  driver: 'bun',
  default: 'bun',
  ...(redis ? { redis } : {}),
  connections: {
    bun: {
      driver: 'bun',
      host,
      port,
      scheme: 'ws',
      options: {
        // Long enough that a reader idling on a quiet feed is not dropped
        // every two minutes and forced to reconnect.
        idleTimeout: 120,
        // A Discover entry is a few kilobytes. A megabyte ceiling is generous
        // and still refuses anything that could only be an attack.
        maxPayloadLength: 1024 * 1024,
        sendPings: true,
        publishToSelf: false,
      },
    },
  },
})

// The same process may also publish (a scheduled rerank broadcasts), so the
// module-level instance `emit` reads has to point at this server.
setServer(server)

// eslint-disable-next-line no-console
console.log(`[opentimes] broadcast server listening on ${host}:${port}${relayEnabled ? ' (redis relay on)' : ''}`)

/**
 * Shut down cleanly so systemd's restart does not leave sockets in TIME_WAIT
 * and the next start can bind the port immediately.
 */
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    // eslint-disable-next-line no-console
    console.log(`[opentimes] broadcast server stopping (${signal})`)
    process.exit(0)
  })
}
