import type { AuthConfig } from '@stacksjs/types'
import { env } from '@stacksjs/env'
import { url as canonicalUrl } from './domains'

/**
 * The origin passkeys are bound to.
 *
 * A passkey only works on the exact origin it was made on, and the browser
 * offers it only over https or on localhost. `PASSKEY_ORIGIN` names that origin
 * when the browser reaches Postline somewhere APP_URL does not say; otherwise
 * APP_URL, which may be written without a scheme (`postline.localhost`).
 */
export function passkeyOrigin(source: { PASSKEY_ORIGIN?: unknown, APP_URL?: unknown } = env): string {
  const raw = String(source.PASSKEY_ORIGIN || source.APP_URL || '').trim()
  if (!raw) return canonicalUrl
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(raw)
  try {
    return new URL(/^https?:\/\//.test(raw) ? raw : `${local ? 'http' : 'https'}://${raw}`).origin
  }
  catch {
    return canonicalUrl
  }
}

/**
 * **Authentication Configuration**
 *
 * This configuration defines all of your authentication options. Because Stacks is fully-typed,
 * you may hover any of the options below and the definitions will be provided. In case
 * you have any questions, feel free to reach out via Discord or GitHub Discussions.
 */
export default {
  /**
   * The authentication guard to use for your application.
   */
  default: 'api',

  /**
   * The authentication guards available for your application.
   */
  guards: {
    api: {
      driver: 'token',
      provider: 'users',
    },
  },

  /**
   * The authentication providers available for your application.
   */
  providers: {
    users: {
      driver: 'database',
      table: 'users',
    },
  },

  /**
   * The username field used for authentication.
   */
  username: env.AUTH_USERNAME_FIELD || 'email',

  /**
   * The password field used for authentication.
   */
  password: env.AUTH_PASSWORD_FIELD || 'password',

  /**
   * The token expiry time in milliseconds (default: 30 days).
   */
  tokenExpiry: env.AUTH_TOKEN_EXPIRY ||30 * 24 * 60 * 60 * 1000,

  /**
   * The token abilities that are granted by default.
   */
  defaultAbilities: ['*'],

  /**
   * The token name used when creating new tokens.
   */
  defaultTokenName: 'auth-token',

  /**
   * Password reset configuration.
   */
  passwordReset: {
    /**
     * Token expiration time in minutes.
     * After this time, the reset link becomes invalid.
     *
     * @default 60
     */
    expire: env.AUTH_PASSWORD_RESET_EXPIRE ||60,

    /**
     * Throttle time in seconds between password reset requests.
     * Users must wait this long before requesting another reset email.
     *
     * @default 60
     */
    throttle: env.AUTH_PASSWORD_RESET_THROTTLE ||60,
  },

  /**
   * Passkeys (#95): sign in with Touch ID, a phone or a security key instead
   * of the password. The password keeps working, so a lost passkey never
   * locks the owner out.
   */
  passkeys: {
    enabled: true,
    origin: passkeyOrigin(),
    name: 'Postline',
  },
} satisfies AuthConfig
