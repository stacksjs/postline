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

export const workspaceShellText = workspaceI18n.tm('workspace.shell')
export const workspaceCommandsText = workspaceI18n.tm('workspace.commands')
export const unreadText = workspaceI18n.tm('workspace.unread')

export const workspaceQueueText = workspaceI18n.tm('workspace.queue') as typeof en.workspace.queue
export const workspaceQueuePanelsText = workspaceI18n.tm('workspace.queuePanels') as typeof en.workspace.queuePanels

export const workspaceActivityText = workspaceI18n.tm('workspace.activity') as typeof en.workspace.activity
export const workspaceTimelineText = workspaceI18n.tm('workspace.timeline') as typeof en.workspace.timeline
export const workspaceWritingText = workspaceI18n.tm('workspace.writing') as typeof en.workspace.writing
export const workspaceInboxText = workspaceI18n.tm('workspace.inbox') as typeof en.workspace.inbox
export const workspaceInboxPublicText = workspaceI18n.tm('workspace.inboxPublic') as typeof en.workspace.inboxPublic
