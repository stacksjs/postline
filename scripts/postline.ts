#!/usr/bin/env bun
import process from 'node:process'
import { parseArgs } from 'node:util'

const usage = `Usage: postline create --key <id> --provider <target> [--provider <target>] [--text <text>] [--title <title>] [--at <UTC timestamp>]

Without --text, read the post text from standard input.
Omit --at to save a draft. Use YYYY-MM-DDTHH:MM:SSZ to schedule.
Set POSTLINE_URL to the workspace origin and POSTLINE_TOKEN to an automation token.
Use the same --key when retrying the same submission.`

async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      key: { type: 'string' },
      provider: { type: 'string', multiple: true },
      text: { type: 'string' },
      title: { type: 'string' },
      at: { type: 'string' },
    },
  })
  if (values.help || !positionals.length) {
    console.log(usage)
    return
  }
  if (positionals.length !== 1 || positionals[0] !== 'create')
    throw new Error('Use postline create. See postline --help.')
  if (!values.key || !/^[A-Za-z0-9._:-]{1,128}$/.test(values.key) || !values.provider?.length)
    throw new Error('A valid --key and at least one --provider are required.')
  const token = process.env.POSTLINE_TOKEN?.trim()
  if (!token) throw new Error('Set POSTLINE_TOKEN to a Postline automation token.')
  const url = URL.parse(process.env.POSTLINE_URL?.trim() || '')
  const local = url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (!url || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || (url.protocol !== 'https:' && !(local && url.protocol === 'http:')))
    throw new Error('Set POSTLINE_URL to the HTTPS workspace origin or an HTTP loopback origin.')
  if (values.text === undefined && process.stdin.isTTY)
    throw new Error('Pass --text or pipe the post body into standard input.')
  const text = values.text ?? await Bun.stdin.text()

  const result = await fetch(new URL('/api/postline/v1/posts', url), {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': values.key,
    },
    body: JSON.stringify({ text, title: values.title, providers: values.provider, scheduledAt: values.at }),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  })
  const data = await result.json().catch(() => null) as { ok?: boolean, error?: string, data?: object } | null
  if (!result.ok || !data?.ok || !data.data)
    throw new Error(typeof data?.error === 'string' ? data.error : `Postline returned HTTP ${result.status}.`)
  console.log(JSON.stringify(data.data))
}

try {
  await main()
}
catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
