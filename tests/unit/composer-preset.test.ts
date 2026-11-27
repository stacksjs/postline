import { describe, expect, test } from 'bun:test'
import { composerPresets } from '../../app/Services/ComposerPresetService'

describe('saved Composer text', () => {
  test('creates, edits, and deletes a saved template', async () => {
    const created = await composerPresets.save(undefined, { kind: 'template', name: '  Launch post ', body: 'Launch\n\nWhat shipped' })
    try {
      expect(created.name).toBe('Launch post')
      expect(await composerPresets.list()).toContainEqual(created)
      const updated = await composerPresets.save(created.uuid, { kind: 'template', name: 'Release notes', body: 'New in this release:' })
      expect(updated).toEqual({ ...created, name: 'Release notes', body: 'New in this release:' })
    }
    finally {
      await composerPresets.remove(created.uuid)
    }
    expect((await composerPresets.list()).some(preset => preset.uuid === created.uuid)).toBe(false)
    await expect(composerPresets.save(created.uuid, created)).rejects.toThrow('no longer exists')
  })

  test('formats Unicode hashtag sets and keeps the first spelling of a repeated tag', async () => {
    const preset = await composerPresets.save(undefined, { kind: 'hashtags', name: 'Cafe', body: '#Cafe\u0301, CAFÉ, 发布 #OpenSource' })
    try {
      expect(preset.body).toBe('#Café #发布 #OpenSource')
      await expect(composerPresets.save(preset.uuid, { ...preset, body: '#Open-Source' })).rejects.toThrow('Separate hashtags')
      expect(await composerPresets.list()).toContainEqual(preset)
    }
    finally {
      await composerPresets.remove(preset.uuid)
    }
  })
})
