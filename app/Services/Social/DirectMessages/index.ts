/**
 * DM transport registry.
 *
 * The inbox counterpart of the publishing drivers: one place that knows which
 * networks Postline can hold a conversation on, so the service layer never
 * names a provider directly.
 */

import type { DmProvider, DmTransport } from '../../../Support/Social/direct-messages'
import { BlueskyDmTransport } from './bluesky'
import { MastodonDmTransport } from './mastodon'

const transports: Record<DmProvider, DmTransport> = {
  bluesky: new BlueskyDmTransport(),
  mastodon: new MastodonDmTransport(),
}

export function getDmTransport(provider: DmProvider): DmTransport {
  const transport = transports[provider]
  if (!transport) throw new Error(`Postline cannot read DMs on "${provider}" yet.`)

  return transport
}

export function listDmTransports(): DmTransport[] {
  return Object.values(transports)
}
