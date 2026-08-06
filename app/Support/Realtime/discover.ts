/**
 * Discover's realtime surface.
 *
 * Built on `@stacksjs/realtime`, which is the framework's integration over
 * ts-broadcasting, so this goes through the same broadcast server the rest of
 * the app uses rather than opening a second one.
 *
 * Three channels rather than one. A reader looking at the short feed should
 * not receive an essay they cannot see, and a reader on either feed should not
 * have to filter events client-side to find out whether an update concerns
 * them. The combined `discover` channel exists for surfaces that show both,
 * like the unread badge.
 *
 * All of it is public. Discover only ever carries entries from publications
 * that opted in to being indexed, so there is nothing here to authorize; a
 * private channel would imply a permission check that does not exist.
 *
 * Emission is deliberately fire-and-forget, and goes through `publish` rather
 * than `emit` directly: in production the web process and the WebSocket server
 * are separate systemd services, so an in-process emit would reach nobody. See
 * `publisher.ts` for that boundary. Either way the entry is already committed
 * by the time this runs, so a dropped event costs a reader one refresh, never
 * a lost post.
 */

import type { DiscoverForm } from '../Social/discover'
import { publish } from './publisher'

/** Everything, for surfaces that show both feeds. */
export const DISCOVER_CHANNEL = 'discover'

/** Per-feed channels, so a subscriber only receives the form it is showing. */
export function discoverChannelFor(form: DiscoverForm): string {
  return `discover.${form}`
}

export type DiscoverEvent = 'EntryPublished' | 'EntryUpdated' | 'EntryRemoved'

/**
 * Announce an entry to the combined channel and to its own feed.
 *
 * Both are sent because a client subscribed to `discover.short` is not
 * subscribed to `discover`, and vice versa. Sending twice to two channels is
 * cheaper than making every client subscribe to both and deduplicate.
 */
export function broadcastDiscoverEntry(event: DiscoverEvent, entry: { id: number, form: DiscoverForm } & Record<string, unknown>): void {
  // Not awaited: the entry is committed, and a reader waiting on a Redis round
  // trip to see their own publish succeed would be the wrong trade.
  void publish(DISCOVER_CHANNEL, event, entry)
  void publish(discoverChannelFor(entry.form), event, entry)
}
