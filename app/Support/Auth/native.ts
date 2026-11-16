const NATIVE_HEADER = 'x-postline-native'
const NATIVE_HEADER_VALUE = 'craft'

type RequestHeaders = Pick<Headers, 'get'>

function isProduction(environment: string): boolean {
  return environment === 'production' || environment === 'prod'
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized.endsWith('.localhost')
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    return isLoopbackHostname(new URL(origin).hostname)
  }
  catch {
    return false
  }
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase()
  if (normalized.startsWith('['))
    return normalized.startsWith('[::1]')

  return isLoopbackHostname(normalized.split(':')[0] || '')
}

/**
 * Whether this process is the desktop app's own agent.
 *
 * The agent listens on a loopback port that only the app's window can call:
 * the framework's launcher refuses any request without the cookie it minted
 * for this launch, and any whose Host is not that port. By the time a request
 * reaches the router it has already been proven to come from the person
 * sitting at the Mac, whose data this is, so there is nobody to sign in.
 *
 * `app/Desktop/data.ts` sets the flag. It is read from the environment and
 * never from a request, so nothing a caller sends can claim it.
 */
export function isDesktopAgent(env: Record<string, string | undefined> = process.env): boolean {
  return env.POSTLINE_DESKTOP_AGENT === '1'
}

export function allowsNativeAppWithoutLogin(
  headers: RequestHeaders,
  environment = process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development',
): boolean {
  if (isDesktopAgent())
    return true

  if (isProduction(environment) || headers.get(NATIVE_HEADER) !== NATIVE_HEADER_VALUE)
    return false

  const origin = headers.get('origin')
  if (origin && isLoopbackOrigin(origin))
    return true

  const host = headers.get('host')
  return host ? isLoopbackHost(host) : false
}
