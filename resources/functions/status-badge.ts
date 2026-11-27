/** Use the same badge tones for a post in Queue and on a campaign board. */
export function postStatusVariant(status?: string): 'default' | 'success' | 'info' | 'warning' | 'danger' {
  switch (status) {
    case 'active':
    case 'published':
    case 'queued':
      return 'success'
    case 'ready':
    case 'scheduled':
      return 'info'
    case 'missed':
    case 'partly sent':
    case 'publishing':
      return 'warning'
    case 'failed':
      return 'danger'
    default:
      return 'default'
  }
}
