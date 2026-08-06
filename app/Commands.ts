export interface CommandConfig {
  /** The command file name (without .ts extension) */
  file: string
  /** Whether the command is enabled */
  enabled?: boolean
  /** Command aliases */
  aliases?: string[]
}

export type CommandRegistry = Record<string, string | CommandConfig>

/**
 * The application's command registry.
 *
 * Commands listed here will be auto-loaded by the CLI.
 * You can use a simple string (file name) or a config object for more control.
 *
 * @example
 * // Simple registration
 * 'inspire': 'Inspire',
 *
 * // With config
 * 'send-emails': {
 *   file: 'SendEmails',
 *   enabled: true,
 *   aliases: ['emails', 'mail'],
 * },
 */
export default {
  'inspire': 'Inspire',
  // Moves the app between `theopentimes.org` and `opentimes.stacksjs.com` by
  // writing DOMAIN_MODE into an env file. Registers `domain`, `domain:list` and
  // `domain:use`; `dns` is the framework's own record-listing command and is
  // deliberately left alone.
  //
  // Registered as a bare string, not `{ file, aliases }`: the registry's alias
  // path calls `buddy.alias(...)`, which the installed CLI object does not
  // implement (buddy 0.70.255, dist/cli.js:133) and which throws before the
  // command is registered at all. Command-level aliases declared inside
  // Domain.ts work fine.
  'domain': 'Domain',
} satisfies CommandRegistry
