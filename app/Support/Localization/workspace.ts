import { createI18n } from '@stacksjs/i18n/client'
import app from '../../../config/app'
import en from '../../../locales/en.json'

const workspaceI18n = createI18n({
  locale: app.locale,
  fallbackLocale: app.fallbackLocale,
  messages: { en },
})

export const workspaceText = workspaceI18n.t.bind(workspaceI18n)

export const workspaceShellText = workspaceI18n.tm('workspace.shell')
export const workspaceCommandsText = workspaceI18n.tm('workspace.commands')
