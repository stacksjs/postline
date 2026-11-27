export function composerScheduleIso(timestamp: string | null): string | null {
  if (!timestamp) return null
  const date = new Date(`${timestamp.replace(' ', 'T')}Z`)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

export function composerQueueTimestamp(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ')
}
