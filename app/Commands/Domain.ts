import type { ResolvedDomains } from '~/config/domains'
import type { CLI } from '@stacksjs/types'
// triggered via `$your-cli domain` and `buddy domain`
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { encryptEnv, parse, resolveEnvFile } from '@stacksjs/env'
import { ExitCode } from '@stacksjs/types'
import { APEX, LEGACY_HOSTS, LOCAL_HOST, resolveDomains, SHORT_DOMAINS, SUBDOMAIN } from '~/config/domains'

/**
 * `buddy domain` — move the app between hosting shapes without hand-editing
 * config.
 *
 * The app can live at a subdomain of the shared Stacks box
 * (`opentimes.stacksjs.com`) or at its own apex (`theopentimes.org`). Which one
 * is canonical is a single env value, `DOMAIN_MODE`, that config/domains.ts
 * resolves and config/app.ts, config/dns.ts and config/cloud.ts all read. This
 * command is the only thing that writes it.
 *
 * WHY IT WRITES THE ENV FILE AND NOT A CONFIG FILE
 *
 * The mode differs per environment — production can be on the apex while a
 * staging box is still on a subdomain — and config files are shared by all of
 * them. An env value is the only place that distinction fits.
 *
 * ENCRYPTED FILES
 *
 * `.env.production` is encrypted at rest. The upsert below writes plaintext and
 * then re-runs `encryptEnv`, which encrypts only values that are not already
 * ciphertext — so the touched keys get sealed and every untouched key keeps the
 * exact bytes it already had. Re-encrypting the whole file would work too, but
 * would rewrite 40-odd unrelated lines and make the diff unreviewable.
 */

interface DomainOptions {
  env?: string
  file?: string
  dryRun?: boolean
}

/** Values this command owns in an env file. */
interface EnvPatch {
  DOMAIN_MODE: string
  APP_DOMAIN: string
  APP_URL?: string
}

const KNOWN_TARGETS = new Set(['domain', 'apex', 'subdomain'])

/** Which env file a `--env` (or its absence) points at. */
function envFileFor(options: DomainOptions): string {
  return options.file || resolveEnvFile('', options.env ?? process.env.APP_ENV ?? 'development') || '.env'
}

/**
 * The private key for one env file, read straight out of `.env.keys`.
 *
 * Deliberately not `resolvePrivateKey()` from @stacksjs/env: that helper checks
 * `process.env.DOTENV_PRIVATE_KEY` *before* falling back to the keys file, and
 * this project's `.env` ends with a development `DOTENV_PRIVATE_KEY`. Asking it
 * for the production key therefore returned the development one, decryption
 * failed silently, and `buddy domain --env production` printed a canonical URL
 * made of ciphertext.
 */
function privateKeyFor(file: string): string | undefined {
  if (!existsSync('.env.keys'))
    return undefined

  const suffix = (file.split('/').pop() ?? '').replace(/^\.env\.?/, '').toUpperCase()
  const { parsed } = parse(readFileSync('.env.keys', 'utf-8'))

  return (suffix ? parsed[`DOTENV_PRIVATE_KEY_${suffix}`] : undefined) ?? parsed.DOTENV_PRIVATE_KEY
}

/**
 * Read an env file's values, decrypting where we hold the key.
 *
 * `parse` leaves a value as ciphertext when no private key is available rather
 * than throwing, which is what we want: reporting on a file whose key is not on
 * this machine should degrade to a visible warning, not abort.
 */
function readEnvFile(file: string): Record<string, string> {
  if (!existsSync(file))
    return {}

  const privateKey = privateKeyFor(file)
  const values = parse(readFileSync(file, 'utf-8'), privateKey ? { privateKey } : {}).parsed

  // A value we could not decrypt is worse than a missing one: it would be
  // spliced into a hostname and reported as fact. Drop it and say so.
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string' && value.startsWith('encrypted:')) {
      console.error(`  ! ${key} in ${file} could not be decrypted — no private key for it in .env.keys. Showing the default instead.`)
      delete values[key]
    }
  }

  return values
}

/** Whether any value in the file is stored as ciphertext. */
function isEncrypted(file: string): boolean {
  return existsSync(file) && /^[A-Z_][A-Z0-9_]*="?enc(?:rypted)?:/m.test(readFileSync(file, 'utf-8'))
}

/**
 * Set each key in place, appending only the ones the file does not already
 * mention. Line-level rather than a re-serialise so comments, blank lines and
 * grouping all survive — an env file is documentation as much as data here.
 */
function upsert(file: string, patch: EnvPatch): string[] {
  const lines = existsSync(file) ? readFileSync(file, 'utf-8').split('\n') : []
  const touched: string[] = []

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined)
      continue

    const rendered = `${key}="${value}"`
    const index = lines.findIndex(line => line.trimStart().startsWith(`${key}=`))

    if (index === -1)
      lines.push(rendered)
    else
      lines[index] = rendered

    touched.push(key)
  }

  writeFileSync(file, lines.join('\n'), 'utf-8')

  return touched
}

function describe(resolved: ResolvedDomains, file: string): void {
  console.log('')
  console.log(`  env file    ${file}`)
  console.log(`  mode        ${resolved.mode}`)
  console.log(`  canonical   ${resolved.url}`)
  console.log('')
  console.log('  redirects (301, path preserved)')
  for (const domain of resolved.redirects)
    console.log(`    https://${domain}  ->  ${resolved.url}`)
  console.log('')
}

export default function (cli: CLI) {
  cli
    .command('domain', 'Show which domain this app is served on')
    .option('--file [file]', 'Read a specific env file instead of the one --env implies', { default: '' })
    .alias('domain:show')
    .action((options: DomainOptions) => {
      const file = envFileFor(options)
      const values = readEnvFile(file)

      describe(resolveDomains(values), file)
      console.log(`  Switch with: buddy domain:use <domain|subdomain|host>${options.env ? ` --env ${options.env}` : ''}`)
      console.log('')
      process.exit(ExitCode.Success)
    })

  cli
    .command('domain:list', 'List every domain this project owns and its role')
    .action((options: DomainOptions) => {
      const file = envFileFor(options)
      const { canonical, redirects } = resolveDomains(readEnvFile(file))

      console.log('')
      console.log(`  ${APEX.padEnd(28)} apex${canonical === APEX ? ' · canonical' : ''}`)
      for (const domain of SHORT_DOMAINS)
        console.log(`  ${domain.padEnd(28)} short form${canonical === domain ? ' · canonical' : ''}`)
      console.log(`  ${SUBDOMAIN.padEnd(28)} shared-box tenant${canonical === SUBDOMAIN ? ' · canonical' : ''}`)
      for (const domain of LEGACY_HOSTS)
        console.log(`  ${domain.padEnd(28)} legacy · redirect only`)
      console.log(`  ${LOCAL_HOST.padEnd(28)} development only`)
      console.log('')
      console.log(`  ${redirects.length} of them redirect to https://${canonical}`)
      console.log('')
      process.exit(ExitCode.Success)
    })

  cli
    .command('domain:use [target]', 'Serve on the apex domain, the shared subdomain, or a specific host')
    .option('--file [file]', 'Write to a specific env file instead of the one --env implies', { default: '' })
    .example('buddy domain:use domain                 # theopentimes.org')
    .example('buddy domain:use subdomain              # opentimes.stacksjs.com')
    .example('buddy domain:use staging.theot.org      # any other host')
    .example('buddy domain:use domain --env production')
    .action((target: string | undefined, options: DomainOptions) => {
      if (!target) {
        console.error('Missing target. Pass `domain`, `subdomain`, or a hostname.')
        process.exit(ExitCode.FatalError)
      }

      const choice = String(target).trim().toLowerCase()

      // Anything that is not one of the two declared modes is treated as an
      // explicit host and pinned via APP_DOMAIN. Validated first, because a
      // typo'd mode ("subdomian") would otherwise be silently accepted as a
      // hostname and written into production.
      const isHost = !KNOWN_TARGETS.has(choice)
      if (isHost && !/^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(choice)) {
        console.error(`"${target}" is neither \`domain\`, \`subdomain\`, nor a valid hostname.`)
        process.exit(ExitCode.FatalError)
      }

      const patch: EnvPatch = isHost
        ? { DOMAIN_MODE: 'domain', APP_DOMAIN: choice }
        : { DOMAIN_MODE: choice === 'subdomain' ? 'subdomain' : 'domain', APP_DOMAIN: '' }

      const file = envFileFor(options)
      const resolved = resolveDomains(patch)

      // APP_URL is the origin the app builds absolute links from. In the local
      // env file it is the `.localhost` dev host and must survive a mode
      // switch — a developer flipping to `domain` wants to preview what
      // production will look like, not to point their dev server at the live
      // site. Deployed env files get it kept in step with the canonical host.
      if (file !== '.env')
        patch.APP_URL = resolved.canonical

      if (options.dryRun) {
        console.log(`Would write to ${file}:`)
        for (const [key, value] of Object.entries(patch))
          console.log(`  ${key}="${value}"`)
        describe(resolved, file)
        process.exit(ExitCode.Success)
      }

      if (!existsSync(file)) {
        console.error(`No ${file} to write to. Create it first (copy .env.example), then re-run.`)
        process.exit(ExitCode.FatalError)
      }

      const sealed = isEncrypted(file)
      const touched = upsert(file, patch)

      if (sealed) {
        // Only the plaintext lines just written get encrypted; every value
        // already stored as ciphertext is passed through untouched.
        const result = encryptEnv({ file })
        if (!result.success) {
          console.error(`Wrote ${file} but could not re-encrypt it: ${result.error}`)
          console.error(`${touched.join(', ')} are currently in plaintext. Run \`buddy env:encrypt --file ${file}\` before committing.`)
          process.exit(ExitCode.FatalError)
        }
      }

      console.log(`${file} now serves ${resolved.url}${sealed ? ' (re-encrypted)' : ''}`)
      describe(resolved, file)
      console.log('  Next: `buddy deploy` reconciles DNS, certificates and the redirect hosts.')
      console.log('')
      process.exit(ExitCode.Success)
    })

  cli.on('domain:*', () => {
    console.error('Invalid command: %s\nSee --help for a list of available commands.', cli.args.join(' '))
    process.exit(ExitCode.FatalError)
  })
}
