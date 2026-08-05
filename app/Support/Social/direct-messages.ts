/**
 * Postline's direct-message contract.
 *
 * DMs are deliberately modelled apart from the publishing surface in
 * `types.ts`. Publishing is one-way and fan-out — one body, many networks.
 * A DM is a two-way thread against a single network, so the useful unit is a
 * conversation, not a post, and there is nothing to crosspost.
 *
 * Every network that can do this at all is behind a different shape: Bluesky
 * has first-class convos, X has a flat event stream you group yourself, and
 * Mastodon fakes threads out of direct-visibility statuses. `DmTransport` is
 * the seam that hides all three, so `DirectMessageService` only ever deals in
 * conversations and messages.
 */

import type { SocialProvider } from './types'

/** Networks Postline can currently read and answer DMs on. */
export const DM_PROVIDERS = ['bluesky', 'twitter', 'mastodon'] as const

export type DmProvider = typeof DM_PROVIDERS[number]

/**
 * Why the remaining connected networks are not in `DM_PROVIDERS`.
 *
 * Surfaced verbatim in the inbox so a missing network reads as a known
 * limitation with a cause, rather than as something Postline forgot.
 */
export const DM_UNAVAILABLE: Partial<Record<SocialProvider, string>> = {
  instagram: 'Instagram DMs need a Professional account with the instagram_manage_messages permission, which Postline does not request yet.',
  threads: 'Threads has no public messaging API — its inbox is app-only.',
  linkedin: 'LinkedIn messaging is limited to partner-approved apps.',
  facebook: 'Facebook Page messaging needs the pages_messaging permission, which Postline does not request yet.',
  tiktok: 'TikTok has no public messaging API.',
}

export function isDmProvider(value: unknown): value is DmProvider {
  return DM_PROVIDERS.includes(String(value) as DmProvider)
}

/** The other side of a conversation. Postline itself is never listed. */
export interface DmParticipant {
  /** Provider-side id — a DID, numeric user id, or account id. */
  remoteId: string
  handle: string
  name?: string | null
  avatar?: string | null
}

/** One conversation as the network reports it, before it is persisted. */
export interface DmConversationCandidate {
  remoteId: string
  participants: DmParticipant[]
  /** Provider-reported unread count; Postline keeps its own when absent. */
  unreadCount: number
  lastMessageAt?: string | null
  lastMessageText?: string | null
  /** Whether the most recent message was sent by us. */
  lastMessageOutgoing?: boolean
}

/** One message inside a conversation, before it is persisted. */
export interface DmMessageCandidate {
  remoteId: string
  conversationRemoteId: string
  direction: 'incoming' | 'outgoing'
  authorRemoteId: string
  authorHandle: string
  authorName?: string | null
  body: string
  /** ISO-8601. Normalized to a SQLite timestamp on the way into the database. */
  sentAt: string
}

/**
 * The narrow surface `DirectMessageService` needs from a network.
 *
 * Each implementation owns its own credential lookup and token refresh, for
 * the same reason `ProviderPurgeAdapter` does: the service that already knows
 * how to keep a session alive should be the one doing it.
 */
export interface DmTransport {
  provider: DmProvider
  /** Longest body the network accepts in a single message. */
  characterLimit: number
  /** Conversations, most recently active first. */
  listConversations: (limit: number) => Promise<DmConversationCandidate[]>
  /** Messages in one conversation, oldest first. */
  listMessages: (conversationRemoteId: string, limit: number) => Promise<DmMessageCandidate[]>
  /** Send a reply into an existing conversation and return what was created. */
  sendMessage: (conversationRemoteId: string, body: string) => Promise<DmMessageCandidate>
  /**
   * Clear the unread flag on the network too, so reading a thread in Postline
   * does not leave it bold in the official client. Optional — X has no such
   * endpoint.
   */
  markRead?: (conversationRemoteId: string) => Promise<void>
}
