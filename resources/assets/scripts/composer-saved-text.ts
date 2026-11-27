import type { ComposerPreset, ComposerPresetKind } from '../../../app/Services/ComposerPresetService'
import { requestJson } from '../../functions/postline-client'

const endpoint = '/api/postline/composer/presets'

export async function loadSavedText(): Promise<ComposerPreset[]> {
  const { data } = await requestJson(endpoint, { cache: 'no-store' }, 'Could not load saved text.')
  return data
}

export async function storeSavedText(input: { uuid: string, name: string, body: string, kind: ComposerPresetKind }, items: ComposerPreset[]) {
  const { uuid, ...fields } = input
  const { data } = await requestJson(endpoint, {
    method: 'POST',
    body: JSON.stringify({ ...(uuid && { uuid }), ...fields }),
  }, 'Could not save the text.')
  return {
    uuid: data.uuid,
    items: [...items.filter(item => item.uuid !== data.uuid), data].sort((a, b) => a.name.localeCompare(b.name)),
  }
}

export async function deleteSavedText(uuid: string, items: ComposerPreset[]): Promise<ComposerPreset[]> {
  await requestJson(`${endpoint}/delete`, { method: 'POST', body: JSON.stringify({ uuid }) }, 'Could not delete the saved text.')
  return items.filter(item => item.uuid !== uuid)
}
