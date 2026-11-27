import { db } from '@stacksjs/database'
import { UserFacingError } from '../Support/Http/user-error'
import { ensureAccount, now, uuid } from './Social/support'

export type ComposerPresetKind = 'snippet' | 'template' | 'hashtags'

interface PresetInput {
  kind: unknown
  name: unknown
  body: unknown
}

export interface ComposerPreset {
  uuid: string
  kind: ComposerPresetKind
  name: string
  body: string
}

const fields = ['uuid', 'kind', 'name', 'body'] as const

function presetId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value))
    throw new UserFacingError('Choose a saved item.')
  return value.toLowerCase()
}

function validatePreset({ kind, name: rawName, body: rawBody }: PresetInput): Omit<ComposerPreset, 'uuid'> {
  if (kind !== 'snippet' && kind !== 'template' && kind !== 'hashtags')
    throw new UserFacingError('Choose a snippet, template, or hashtag set.')

  const name = typeof rawName === 'string' ? rawName.trim() : ''
  if (!name || name.length > 80) throw new UserFacingError('Enter a name of up to 80 characters.')

  let body = typeof rawBody === 'string' ? rawBody.trim() : ''
  if (!body || body.length > 10000) throw new UserFacingError('Enter text of up to 10,000 characters.')
  if (kind === 'hashtags') {
    const tags = body.split(/[\s,]+/u).filter(Boolean).map(tag => tag.replace(/^#/, '').normalize('NFC'))
    if (!tags.length || tags.some(tag => !/^[\p{L}\p{N}_][\p{L}\p{M}\p{N}_]*$/u.test(tag)))
      throw new UserFacingError('Separate hashtags with spaces or commas. Use letters, numbers, and underscores.')
    const unique = new Map<string, string>()
    for (const tag of tags) {
      const key = tag.toLowerCase()
      if (!unique.has(key)) unique.set(key, `#${tag}`)
    }
    body = [...unique.values()].join(' ')
    if (body.length > 10000) throw new UserFacingError('Use up to 10,000 characters of hashtags.')
  }
  return { kind, name, body }
}

export function readComposerPreset(input: unknown): ComposerPreset {
  if (!input || typeof input !== 'object') throw new UserFacingError('There is an invalid saved Composer item.')
  const row = input as PresetInput & { uuid: unknown }
  return { uuid: presetId(row.uuid), ...validatePreset(row) }
}

export class ComposerPresetService {
  async list(accountId?: number): Promise<ComposerPreset[]> {
    const presets = await db.selectFrom('composer_presets').select(fields)
      .where('account_id', '=', accountId ?? await ensureAccount())
      .orderBy('name', 'asc').orderBy('uuid', 'asc').execute()
    return presets.map(readComposerPreset)
  }

  async save(id: unknown, input: PresetInput): Promise<ComposerPreset> {
    const values = validatePreset(input)
    const accountId = await ensureAccount()
    const updatedAt = now()
    if (id !== undefined && id !== null) {
      const uuid = presetId(id)
      const preset = await db.updateTable('composer_presets').set({ ...values, updated_at: updatedAt })
        .where('uuid', '=', uuid).where('account_id', '=', accountId).returning('uuid').executeTakeFirst()
      if (!preset) throw new UserFacingError('This saved item no longer exists.')
      return { uuid, ...values }
    }

    const preset = { uuid: uuid(), ...values }
    await db.insertInto('composer_presets').values({ ...preset, account_id: accountId, created_at: updatedAt, updated_at: updatedAt }).execute()
    return preset
  }

  async remove(id: unknown): Promise<void> {
    await db.deleteFrom('composer_presets').where('uuid', '=', presetId(id)).where('account_id', '=', await ensureAccount()).execute()
  }

  async restore(accountId: number, preset: ComposerPreset): Promise<boolean> {
    const timestamp = now()
    const restored = await db.unsafe(`
      INSERT INTO composer_presets (uuid, kind, name, body, account_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (uuid) DO NOTHING RETURNING uuid
    `, [preset.uuid, preset.kind, preset.name, preset.body, accountId, timestamp, timestamp])
    return restored.length > 0
  }
}

export const composerPresets = new ComposerPresetService()
