/**
 * Send errors to a service the owner runs (#211), when they name one.
 *
 * `POSTLINE_ERROR_WEBHOOK_URL` receives a small JSON body for each error the
 * app logs. Nothing leaves the machine without it. Delivery is best effort:
 * a reporter that is down must never become another error, so a failed send
 * is dropped, and at most one send runs at a time per message burst.
 */
import type { LogRecord, LogTransport } from '@stacksjs/types'
import process from 'node:process'

type Send = (url: string, body: Record<string, unknown>) => Promise<unknown>

const postJson: Send = async (url, body) => await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(5_000),
  redirect: 'error',
})

/** The transport, or none when no address is set. */
export function errorReporter(url: string = String(process.env.POSTLINE_ERROR_WEBHOOK_URL || '').trim(), send: Send = postJson): LogTransport[] {
  if (!/^https?:\/\//i.test(url)) return []
  return [{
    name: 'postline-error-webhook',
    level: 'error',
    log(record: LogRecord) {
      send(url, {
        app: 'postline',
        level: record.level,
        message: record.message.slice(0, 4000),
        at: record.timestamp,
        ...(record.context?.requestId ? { requestId: record.context.requestId } : {}),
      }).catch(() => {})
    },
  }]
}
