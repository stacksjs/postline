const NATIVE_HEADER = 'x-ot-native'
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

export function allowsNativeAppWithoutLogin(
  headers: RequestHeaders,
  environment = process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development',
): boolean {
  if (isProduction(environment) || headers.get(NATIVE_HEADER) !== NATIVE_HEADER_VALUE)
    return false

  const origin = headers.get('origin')
  if (origin && isLoopbackOrigin(origin))
    return true

  const host = headers.get('host')
  return host ? isLoopbackHost(host) : false
}
