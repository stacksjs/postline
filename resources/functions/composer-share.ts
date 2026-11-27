const SHARE_KEY = 'postline-share'
const MAX_URL_LENGTH = 4_096

export function shareablePage(value: string | undefined): string | null {
  if (!value || value.length > MAX_URL_LENGTH) return null
  const url = URL.parse(value)
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null
  return url.href.length <= MAX_URL_LENGTH ? url.href : null
}

export function shareWorkspace(value: string): string | null {
  const url = URL.parse(value)
  if (!url || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  return url.protocol === 'https:' || (url.protocol === 'http:' && loopback) ? url.origin : null
}

export function sharedPage(hash: string): string | null {
  if (!hash.startsWith(`#${SHARE_KEY}=`)) return null
  return shareablePage(new URLSearchParams(hash.slice(1)).get(SHARE_KEY) ?? undefined)
}

export function shareComposerPath(page: string | null): string {
  return page ? `/composer#${new URLSearchParams({ [SHARE_KEY]: page })}` : '/composer'
}

export function takeSharedPage(): string | null {
  if (location.pathname !== '/composer') return null
  const page = sharedPage(location.hash)
  if (page) history.replaceState(history.state, '', location.pathname + location.search)
  return page
}
