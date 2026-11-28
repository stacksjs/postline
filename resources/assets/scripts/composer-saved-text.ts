import type { ComposerPreset, ComposerPresetKind } from '../../../app/Services/ComposerPresetService'
import en from '../../../locales/composer-saved-text/en.json'
import es from '../../../locales/composer-saved-text/es.json'
import { requestJson } from '../../functions/postline-client'

const endpoint = '/api/postline/composer/presets'
const messages = { en, es: es satisfies typeof en }

function savedTextCopy(locale: string): typeof en {
  return locale === 'es' ? messages.es : messages.en
}

export async function loadSavedText(locale: string): Promise<ComposerPreset[]> {
  const { data } = await requestJson(endpoint, { cache: 'no-store' }, savedTextCopy(locale).loadFailed)
  return data
}

export async function storeSavedText(input: { uuid: string, name: string, body: string, kind: ComposerPresetKind }, items: ComposerPreset[], locale: string) {
  const { uuid, ...fields } = input
  const { data } = await requestJson(endpoint, {
    method: 'POST',
    body: JSON.stringify({ ...(uuid && { uuid }), ...fields }),
  }, savedTextCopy(locale).saveFailed)
  return {
    uuid: data.uuid,
    items: [...items.filter(item => item.uuid !== data.uuid), data].sort((a, b) => a.name.localeCompare(b.name)),
  }
}

export async function deleteSavedText(uuid: string, items: ComposerPreset[], locale: string): Promise<ComposerPreset[]> {
  await requestJson(`${endpoint}/delete`, { method: 'POST', body: JSON.stringify({ uuid }) }, savedTextCopy(locale).deleteFailed)
  return items.filter(item => item.uuid !== uuid)
}
