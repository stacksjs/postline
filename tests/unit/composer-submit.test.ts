import { expect, test } from 'bun:test'
import { composerSubmitCopy, postForm, publishingNotice, summarizePublish } from '../../resources/assets/scripts/composer-submit'

test('queue edits explicitly remove old media and clear saved overrides', () => {
  const form = postForm({
    text: 'New text',
    providers: ['mastodon:5'],
    options: { mastodon_spoiler: '', linkedin_first_comment: '' },
  }, { id: 12, nextSlot: false, removeMedia: true })

  expect(Object.fromEntries(form)).toEqual({
    text: 'New text',
    providers: 'mastodon:5',
    id: '12',
    remove_media: '1',
    variants: '{}',
    mastodon_spoiler: '',
    linkedin_first_comment: '',
  })
})

test('queueing at the next slot sends new attachments and their alt text', () => {
  const file = new File(['fixture'], 'photo.png', { type: 'image/png' })
  const form = postForm({
    text: 'First',
    thread: ['First', 'Second'],
    providers: ['linkedin:1', 'bluesky:2'],
    imageFiles: [{ file, alt: 'The author' }],
    options: { linkedin_first_comment: 'Read more', bluesky_labels: '["graphic-media"]' },
  }, { id: 12, scheduledAt: '2026-12-01 14:00:00', nextSlot: true, removeMedia: true })

  expect(form.get('thread')).toBe('["First","Second"]')
  expect(form.get('next_slot')).toBe('1')
  expect(form.has('scheduled_at')).toBe(false)
  expect(form.has('remove_media')).toBe(false)
  expect(form.get('images')).toBeInstanceOf(File)
  expect(form.get('image_alts')).toBe('["The author"]')
  expect(form.get('linkedin_first_comment')).toBe('Read more')
  expect(form.get('bluesky_labels')).toBe('["graphic-media"]')
})

test('submission feedback uses the workspace locale and keeps provider details', () => {
  const copy = composerSubmitCopy('es')
  expect(publishingNotice(2, 'Bluesky', copy)).toBe('Publicando 2 publicaciones en Bluesky…')
  const result = summarizePublish([
    { provider: 'Bluesky', ok: true, url: 'https://bsky.app/profile/example.test/post/one' },
    { provider: 'Mastodon', ok: false },
  ], 1, 'Bluesky, Mastodon', provider => provider, copy)
  expect(result.notice).toEqual({ title: 'Publicación parcial', tone: 'info', text: 'Se publicó en algunos canales. Mastodon: error' })
  expect(result.lastUrl).toBe('https://bsky.app/profile/example.test/post/one')
})
