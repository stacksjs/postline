import { createI18n } from '@stacksjs/i18n/client'
import en from '../../../locales/composer-media/en.json'
import es from '../../../locales/composer-media/es.json'

const messages = { en, es: es satisfies typeof en }

function mediaTranslator(locale: 'en' | 'es') {
  const i18n = createI18n({ locale, fallbackLocale: 'en', messages })
  return (key: keyof typeof en, values?: Record<string, string | number>) => i18n.t(key, values)
}

const translators = { en: mediaTranslator('en'), es: mediaTranslator('es') }

export function composerMediaText(locale: string) {
  return locale === 'es' ? translators.es : translators.en
}
