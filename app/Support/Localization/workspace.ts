import { createI18n } from '@stacksjs/i18n/client'
import app from '../../../config/app'
import en from '../../../locales/en.json'
import es from '../../../locales/es.json'

const messages = { en, es: es satisfies typeof en }

// The same catalog is used for static builds and live workspace rendering.
export const workspaceLocale = Bun.env.POSTLINE_WORKSPACE_LOCALE === 'es' ? 'es' : app.locale

const workspaceI18n = createI18n({
  locale: workspaceLocale,
  fallbackLocale: app.fallbackLocale,
  messages,
})

export const workspaceText = workspaceI18n.t.bind(workspaceI18n)

export const workspaceShellText = workspaceI18n.tm('workspace.shell') as typeof en.workspace.shell
export const workspaceCommandsText = workspaceI18n.tm('workspace.commands')
export const unreadText = workspaceI18n.tm('workspace.unread')

export const workspaceNavigation = [
  { href: '/composer', view: 'composer', shortcut: '1', icon: 'i-hugeicons-edit-02', primary: true, mobile: true },
  { href: '/queue', view: 'queue', shortcut: '2', icon: 'i-hugeicons-calendar-03', primary: true, mobile: true },
  { href: '/timeline', view: 'timeline', shortcut: '3', icon: 'i-hugeicons-news', primary: true },
  { href: '/analytics', view: 'analytics', shortcut: '4', icon: 'i-hugeicons-chart-line-data-01', primary: true },
  { href: '/campaigns', view: 'campaigns', shortcut: '5', icon: 'i-hugeicons-flowchart-01', primary: true },
  { href: '/listening', view: 'listening', shortcut: '6', icon: 'i-hugeicons-radar-02', primary: true },
  { href: '/inbox', view: 'inbox', shortcut: '7', icon: 'i-hugeicons-message-01', primary: true, mobile: true },
  { href: '/writing', view: 'writing', shortcut: '8', icon: 'i-hugeicons-quill-write-02', primary: true },
  { href: '/activity', view: 'activity', shortcut: '9', icon: 'i-hugeicons-activity-01' },
  { href: '/accounts', view: 'channels', icon: 'i-hugeicons-share-08' },
  { href: '/settings', view: 'settings', shortcut: ',', icon: 'i-hugeicons-settings-02' },
].map(({ view, ...link }) => ({
  ...link,
  label: workspaceText(`workspace.navigation.${view}`),
  mobileLabel: workspaceText(`workspace.navigation.${view === 'composer' ? 'compose' : view}`),
}))

export function workspaceRoutePath(url: string): string {
  return (URL.parse(url, 'http://localhost')?.pathname ?? '/').replace(/\/$/, '') || '/'
}

export const workspaceQueueText = workspaceI18n.tm('workspace.queue') as typeof en.workspace.queue
export const workspaceQueuePanelsText = workspaceI18n.tm('workspace.queuePanels') as typeof en.workspace.queuePanels

export const workspaceActivityText = workspaceI18n.tm('workspace.activity') as typeof en.workspace.activity
export const workspaceTimelineText = workspaceI18n.tm('workspace.timeline') as typeof en.workspace.timeline
export const workspaceListeningText = workspaceI18n.tm('workspace.listening') as typeof en.workspace.listening
export const workspaceAnalyticsText = workspaceI18n.tm('workspace.analytics') as typeof en.workspace.analytics
export const workspaceAnalyticsLinksText = workspaceI18n.tm('workspace.analyticsLinks') as typeof en.workspace.analyticsLinks
export const workspaceWritingText = workspaceI18n.tm('workspace.writing') as typeof en.workspace.writing
export const workspaceBlogErrors = workspaceI18n.tm('workspace.blogErrors') as typeof en.workspace.blogErrors
export const workspaceInboxText = workspaceI18n.tm('workspace.inbox') as typeof en.workspace.inbox
export const workspaceInboxPublicText = workspaceI18n.tm('workspace.inboxPublic') as typeof en.workspace.inboxPublic
export const workspaceChannelsText = workspaceI18n.tm('workspace.channels') as typeof en.workspace.channels
export const workspaceChannelCardText = workspaceI18n.tm('workspace.channelCard') as typeof en.workspace.channelCard
export const workspaceInstagramPagePickerText = workspaceI18n.tm('workspace.instagramPagePicker') as typeof en.workspace.instagramPagePicker
export const workspaceXBrowserSessionText = workspaceI18n.tm('workspace.xBrowserSession') as typeof en.workspace.xBrowserSession
export const workspaceXBrowserErrors = workspaceI18n.tm('workspace.xBrowserErrors') as typeof en.workspace.xBrowserErrors
export const workspacePostOptionsErrors = workspaceI18n.tm('workspace.postOptionsErrors') as typeof en.workspace.postOptionsErrors
export const workspaceCampaignText = workspaceI18n.tm('workspace.campaigns') as typeof en.workspace.campaigns
export const workspaceSettingsText = workspaceI18n.tm('workspace.settings') as typeof en.workspace.settings
export const workspaceLoginText = workspaceI18n.tm('workspace.login') as typeof en.workspace.login
export const workspaceSetupText = workspaceI18n.tm('workspace.setup') as typeof en.workspace.setup
export const workspaceComposerText = workspaceI18n.tm('workspace.composer') as typeof en.workspace.composer
export const workspaceComposerErrors = workspaceI18n.tm('workspace.composerErrors') as typeof en.workspace.composerErrors
export const workspaceSavedText = workspaceI18n.tm('workspace.savedText') as typeof en.workspace.savedText
