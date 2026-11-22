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

/**
 * Whether a request may skip the sign-in.
 *
 * Only the desktop agent's own process may, and that is decided by how the
 * process was started. Nothing about the request is consulted: a header, an
 * Origin and a Host are all things a caller chooses, so none of them can be
 * evidence of who is calling.
 */
export function allowsNativeAppWithoutLogin(): boolean {
  return isDesktopAgent()
}
