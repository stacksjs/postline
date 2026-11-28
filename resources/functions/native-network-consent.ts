import { requestJson } from './postline-client'

const endpoint = '/api/postline/desktop-network-consent'

interface ConsentShell {
  shell?: { openExternal?: (url: string) => Promise<void> }
}

export async function openNativeNetworkConsent(
  host: unknown,
  provider: string,
  test: boolean,
  signal: AbortSignal,
  messages: { browserUnavailable: string, consentExpired: string },
  onBrowserOpened: () => void,
): Promise<string> {
  const shell = (host as ConsentShell)?.shell
  if (typeof shell?.openExternal !== 'function') throw new Error(messages.browserUnavailable)
  const { data } = await requestJson(endpoint, { method: 'POST', signal, body: JSON.stringify({ operation: 'begin', provider, test }) })
  const launchUrl = new URL(data.launchUrl)
  if (launchUrl.origin !== location.origin || launchUrl.pathname !== endpoint + '/launch') throw new Error(messages.browserUnavailable)
  await shell.openExternal(launchUrl.href)
  onBrowserOpened()

  while (!signal.aborted) {
    await new Promise(resolve => setTimeout(resolve, 1_500))
    const { data: result } = await requestJson(endpoint, { method: 'POST', signal, body: JSON.stringify({ operation: 'result', id: data.id }) })
    if (result.state === 'complete' && typeof result.location === 'string' && result.location.startsWith('/accounts?')) return result.location
    if (result.state !== 'pending') break
  }
  signal.throwIfAborted()
  throw new Error(messages.consentExpired)
}
