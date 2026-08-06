/**
 * DM transport registry.
 *
 * Mirrors `DriverRegistry` for the publishing side: one place that knows which
 * networks The Open Times can hold a conversation on, so the service layer never
 * names a provider directly.
 */

import type { DmProvider, DmTransport } from '../../../Support/Social/direct-messages'
import { BlueskyDmTransport } from './bluesky'
import { InstagramDmTransport } from './instagram'
import { MastodonDmTransport } from './mastodon'
import { TwitterDmTransport } from './twitter'

const transports: Record<DmProvider, DmTransport> = {
  bluesky: new BlueskyDmTransport(),
  twitter: new TwitterDmTransport(),
  mastodon: new MastodonDmTransport(),
  instagram: new InstagramDmTransport(),
}

export function getDmTransport(provider: DmProvider): DmTransport {
  const transport = transports[provider]
  if (!transport) throw new Error(`The Open Times cannot read DMs on "${provider}" yet.`)

  return transport
}

export function listDmTransports(): DmTransport[] {
  return Object.values(transports)
}
