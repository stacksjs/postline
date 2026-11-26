import { ACCOUNT_PROVIDERS } from '../Support/Social/targets'
import { directMessages } from './DirectMessageService'
import { keywordMonitoring } from './KeywordMonitoringService'
import { blog } from './Social/BlogService'
import { bluesky } from './Social/BlueskyService'
import { instagram } from './Social/InstagramService'
import { linkedin } from './Social/LinkedInService'
import { mastodon } from './Social/MastodonService'
import { threads } from './Social/ThreadsService'
import { twitter } from './Social/TwitterService'
import { workspace } from './WorkspaceService'

export async function providerStatuses() {
  // The composer renders its channel chips in this order.
  return await Promise.all([
    bluesky.status(),
    twitter.status(),
    linkedin.status(),
    instagram.status(),
    threads.status(),
    mastodon.status(),
    blog.status(),
  ])
}

export async function workspaceUnreadCounts() {
  const [inbox, listening] = await Promise.all([directMessages.unreadCount(), keywordMonitoring.unreadCount()])
  return { inbox, listening }
}

export async function workspaceBootstrap() {
  const [profile, providers, unread] = await Promise.all([
    workspace.profile(),
    providerStatuses(),
    workspaceUnreadCounts(),
  ])
  const byProvider = new Map(providers.map(provider => [provider.provider, 'accounts' in provider ? provider.accounts : []]))
  const accounts = ACCOUNT_PROVIDERS.flatMap(provider => byProvider.get(provider) ?? [])
  return { workspace: profile, providers, accounts, unread }
}
