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
