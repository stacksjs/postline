/**
 * Publishing to the broadcast server from a web request.
 *
 * This exists because of a process boundary that is easy to miss. `emit()` from
 * `@stacksjs/realtime` looks up a *module-level* server instance, so it only
 * reaches sockets when the publishing code and the WebSocket server are the
 * same process. In development they are. In production they are not: the app is
 * a systemd service and the broadcast server is a second one, so every `emit()`
 * from a request handler would find no server, log a warning, and drop the
 * event on the floor.
 *
 * Redis is the seam ts-broadcasting provides for exactly this. The web process
 * publishes to a channel; the broadcast server, subscribed to the same channel,
 * relays to its connected sockets. Same mechanism that lets the server scale to
 * more than one instance later.
 *
 * When Redis is not configured this falls back to the in-process `emit`, which
 * is correct for a single-process dev machine and honest about what it can do:
 * a dropped event costs a reader one refresh, never a lost post.
 */

import type { RedisAdapter as RedisAdapterType } from 'ts-broadcasting'
import { emit } from '@stacksjs/realtime'
import { env } from '@stacksjs/env'

/**
 * Whether to publish through Redis.
 *
 * Keyed on an explicit flag rather than on "is a Redis host set", because
 * nearly every deployment has Redis for the cache and turning that into
 * realtime fan-out silently would be surprising.
 */
export function usesRedisRelay(): boolean {
  const flag = String(env.BROADCAST_REDIS_ENABLED ?? '').toLowerCase()

  return flag === '1' || flag === 'true'
}

function redisConfig() {
  return {
    host: String(env.REDIS_HOST || 'localhost'),
    port: Number(env.REDIS_PORT || 6379),
    password: String(env.REDIS_PASSWORD || '') || undefined,
    keyPrefix: String(env.BROADCAST_REDIS_PREFIX || 'opentimes:realtime:'),
  }
}

/**
 * One adapter per process, connected lazily.
 *
 * A publish happens inside a request, and opening a Redis connection per event
 * would add a handshake to every post. The connection promise is cached rather
 * than the adapter so concurrent publishes during startup share one connect
 * rather than racing to open several.
 */
let adapterPromise: Promise<RedisAdapterType | null> | null = null

async function adapter(): Promise<RedisAdapterType | null> {
  if (!usesRedisRelay()) return null

  adapterPromise ??= (async () => {
    try {
      const { RedisAdapter } = await import('ts-broadcasting')
      const instance = new RedisAdapter(redisConfig())
      await instance.connect()

      return instance
    }
    catch (error) {
      console.warn(`[opentimes] realtime relay unavailable, falling back to in-process: ${error instanceof Error ? error.message : String(error)}`)

      return null
    }
  })()

  return await adapterPromise
}

/**
 * Publish one event to a channel.
 *
 * Never throws and never awaits on the request path's critical work: the row
 * being announced is already committed by the time this runs, so a realtime
 * failure must not turn a successful publish into an error. Returns a promise
 * callers may await in tests.
 */
export async function publish(channel: string, event: string, data: unknown): Promise<void> {
  try {
    const relay = await adapter()
    if (relay) {
      await relay.broadcast(channel, event, data)
      return
    }

    // Single-process: the server, if any, is this one.
    emit(channel, event, data)
  }
  catch (error) {
    console.warn(`[opentimes] realtime publish failed for ${channel}/${event}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Drop the cached connection. Used by tests; harmless in production. */
export function resetPublisher(): void {
  adapterPromise = null
}
