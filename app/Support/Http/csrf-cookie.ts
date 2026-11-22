/**
 * Issue the CSRF cookie explicitly.
 *
 * The web server adds this cookie to page and JSON responses by itself. The
 * desktop agent answers through a different path that does not, so a window
 * there would never receive one and every write would be refused. The seeding
 * route therefore sets it itself, in the same shape the framework's check
 * reads: 32 random bytes as hex, readable by script, two hours.
 */
const NAME = 'X-CSRF-Token'
const TOKEN = /^[0-9a-f]{64}$/

function currentToken(request: Request): string {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const at = part.indexOf('=')
    if (at !== -1 && part.slice(0, at).trim() === NAME)
      return part.slice(at + 1).trim()
  }
  return ''
}

function newToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

/** A response that leaves the browser holding a CSRF cookie. An existing valid one is kept. */
export function csrfSeedResponse(request: Request): Response {
  const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' })

  if (!TOKEN.test(currentToken(request))) {
    const secure = request.url.startsWith('https://') || request.headers.get('x-forwarded-proto') === 'https'
    headers.append('set-cookie', `${NAME}=${newToken()}; Path=/; SameSite=Lax; Max-Age=7200${secure ? '; Secure' : ''}`)
  }

  return new Response('{"ok":true}', { status: 200, headers })
}
