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
 * Emission is deliberately fire-and-forget. `emit` warns and returns when no
 * broadcast server is running, which is the behaviour publishing needs: a
 * post must not fail because the websocket process is down. The entry is
 * already committed by the time any of this runs, so a dropped event costs a
 * reader one refresh, never a lost post.
 */

import type { DiscoverForm } from '../Social/discover'
import { emit } from '@stacksjs/realtime'

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
  emit(DISCOVER_CHANNEL, event, entry)
  emit(discoverChannelFor(entry.form), event, entry)
}
