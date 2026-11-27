import type { ComposerAction } from './composer-draft'

export function composerScheduleIso(timestamp: string | null): string | null {
  if (!timestamp) return null
  const date = new Date(`${timestamp.replace(' ', 'T')}Z`)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

export function composerQueueTimestamp(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ')
}

export function composerActionText(action: ComposerAction, iso: string | null, zone: string, editing: boolean, submitting: boolean): string {
  if (submitting) return action === 'publish' && !editing ? 'Publishing…' : 'Saving…'
  if (action === 'schedule' && iso) {
    const when = new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: zone })
    return `Schedule for ${when}`
  }
  if (editing && action !== 'draft') return 'Update post'
  return action === 'draft' ? 'Save draft' : 'Publish'
}
