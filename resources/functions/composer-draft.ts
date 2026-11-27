export const COMPOSER_DRAFT_KEY = 'postline:composer-draft:v1'
export const COMPOSER_DEFAULT_FORMAT_KEY = 'postline:composer-format'
export const COMPOSER_AUTOSAVE_KEY = 'postline:composer-autosave'

export type ComposerFormat = 'single' | 'thread'
export type ComposerAction = 'publish' | 'schedule' | 'draft'

export interface ComposerDraft {
  activeIndex: number
  mode: ComposerFormat
  action: ComposerAction
  scheduledIso: string | null
  posts: Array<{ text: string }>
  variants: Array<{ provider: string, text: string, shared: string }>
  firstComments?: { linkedin?: string, instagram?: string }
}

const MAX_DRAFT_TEXT = 10_000

export function readComposerDraft(value: string): ComposerDraft | null {
  try {
    const draft: Record<string, unknown> | null = JSON.parse(value)
    if (!draft || !Array.isArray(draft.posts) || draft.posts.length === 0) return null

    const scheduledIso = draft.action === 'schedule' && typeof draft.scheduledIso === 'string'
      && Number.isFinite(Date.parse(draft.scheduledIso)) ? draft.scheduledIso : null
    let action: ComposerAction = 'publish'
    if (scheduledIso) action = 'schedule'
    else if (draft.mode === 'draft' || draft.action === 'draft' || draft.action === 'schedule') action = 'draft'
    const comments = draft.firstComments as ComposerDraft['firstComments']

    return {
      activeIndex: typeof draft.activeIndex === 'number' && Number.isInteger(draft.activeIndex) ? draft.activeIndex : 0,
      mode: draft.mode === 'thread' ? 'thread' : 'single',
      action,
      scheduledIso,
      ...(comments && { firstComments: {
        linkedin: typeof comments.linkedin === 'string' ? comments.linkedin.slice(0, 1250) : undefined,
        instagram: typeof comments.instagram === 'string' ? comments.instagram.slice(0, 1250) : undefined,
      } }),
      // Keep up to the Blog's limit so drafts survive changes to their targets.
      posts: draft.posts.slice(0, 24).map(post => ({ text: String(post?.text || '').slice(0, MAX_DRAFT_TEXT) })),
      variants: Array.isArray(draft.variants)
        ? draft.variants.slice(0, 12).filter(entry => typeof entry?.provider === 'string').map(entry => ({
            provider: entry.provider,
            text: String(entry.text || '').slice(0, MAX_DRAFT_TEXT),
            shared: String(entry.shared || '').slice(0, MAX_DRAFT_TEXT),
          }))
        : [],
    }
  }
  catch {
    return null
  }
}

export function writeComposerDraft(value: ComposerDraft | null): string {
  return value ? JSON.stringify({ ...value, updatedAt: new Date().toISOString(), version: 1 }) : 'null'
}
