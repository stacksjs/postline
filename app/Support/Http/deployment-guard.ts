/**
 * Refuse to serve a public address in development mode.
 *
 * Outside production the framework is deliberately open-handed: an unhandled
 * error answers with its stack, the handler's path and the last queries, and
 * development conveniences stay switched on. That is right on a laptop and
 * wrong on a server, and the difference between the two is one line of `.env`
 * that is easy to leave as the example ships it.
 *
 * So the mode is checked against the address. A development build may serve
 * the machine it is on (`localhost`, `*.localhost`, `*.test`, a loopback
 * address) and nothing else. Anything a stranger could reach has to say it is
 * production.
 */
import { workspaceKeyBytes } from '../Security/workspace-key'

export function isProductionMode(mode: string | undefined): boolean {
  const value = String(mode || '').trim().toLowerCase()
  return value === 'production' || value === 'prod'
}

/** Whether an `APP_URL` can only be reached from this machine. */
export function isLocalOnlyAddress(appUrl: string | undefined): boolean {
  const raw = String(appUrl || '').trim()
  if (!raw)
    return true

  let hostname: string
  try {
    hostname = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`).hostname.toLowerCase()
  }
  catch {
    return false
  }

  const bare = hostname.replace(/^\[|\]$/g, '')
  return bare === 'localhost'
    || bare === '::1'
    || /^127(?:\.\d{1,3}){3}$/.test(bare)
    || bare.endsWith('.localhost')
    || bare.endsWith('.test')
}

export interface DeploymentEnv {
  APP_ENV?: string
  NODE_ENV?: string
  APP_URL?: string
  APP_KEY?: string
}

/** The reason this configuration must not serve requests, or null when it may. */
export function deploymentProblem(env: DeploymentEnv): string | null {
  const mode = env.APP_ENV ?? env.NODE_ENV
  if (isProductionMode(mode)) {
    return workspaceKeyBytes(env.APP_KEY) ? null
      : 'Production needs a valid APP_KEY. Run `./buddy key:generate` for a new workspace or restore the original key from your backup.'
  }
  if (isLocalOnlyAddress(env.APP_URL))
    return null

  return `APP_URL is "${env.APP_URL}", which other machines can reach, but APP_ENV is "${mode || 'unset'}". `
    + 'Development mode shows stack traces and recent queries to anyone who triggers an error. '
    + 'Set APP_ENV=production (and DEBUG=false) in .env, or point APP_URL at a local address.'
}

/** Throw at boot when the configuration is unsafe to serve. */
export function assertSafeDeployment(env: DeploymentEnv = process.env): void {
  const problem = deploymentProblem(env)
  if (problem)
    throw new Error(`Postline will not start: ${problem}`)
}
