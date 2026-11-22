/**
 * What an action tells the client when something throws.
 *
 * Actions used to return `error.message` whatever the error was, so a
 * database error ("no such column: …"), a runtime TypeError or a stack-shaped
 * message reached the browser as readily as "That account is not connected."
 *
 * The rule here: a message is passed on only when app code wrote it for the
 * person using the app, which is to say it was thrown as a plain `Error` (or
 * one of the app's own error classes). Anything the runtime, the database or
 * a library produced is logged and replaced with a sentence that gives
 * nothing away.
 *
 * This is the conservative half of the job. The services still throw plain
 * errors that occasionally embed a network's raw reply; giving those typed
 * errors of their own is tracked with the per-network error work.
 */
import { log } from '@stacksjs/logging'
import { response } from '@stacksjs/router'
import { UnsafeUrlError } from './safe-fetch'

export const GENERIC_FAILURE = 'Something went wrong on our side. Try again.'

const MAX_LENGTH = 300

/** Shapes that mean a message was not written for a person, whoever threw it. */
const INTERNAL = /\bSQLITE_|\bno such (?:table|column)\b|\bsyntax error\b|\bconstraint failed\b|\bis not a function\b|\bCannot read propert|\bundefined is not\b|\bECONN|\bENOENT\b|\bEACCES\b|\n\s+at /i

function writtenForPeople(error: unknown): error is Error {
  if (!(error instanceof Error))
    return false
  if (error instanceof UnsafeUrlError)
    return true
  // Exactly `Error`: what app code throws. Subclasses (TypeError, a database
  // driver's error, an HTTP client's) were not written for the owner.
  return Object.getPrototypeOf(error) === Error.prototype && error.name === 'Error'
}

/** The message to show for a caught error. */
export function publicMessage(error: unknown, fallback = GENERIC_FAILURE): string {
  if (writtenForPeople(error) && error.message && !INTERNAL.test(error.message))
    return error.message.length > MAX_LENGTH ? `${error.message.slice(0, MAX_LENGTH - 1)}…` : error.message

  log.error('[action] an error was withheld from the client', error)
  return fallback
}

type FailureStatus = Extract<Parameters<typeof response.json>[1], number>

/** The JSON failure every Postline action returns. */
export function actionFailure(error: unknown, status: FailureStatus = 422, fallback = GENERIC_FAILURE): ReturnType<typeof response.json> {
  return response.json({ ok: false, error: publicMessage(error, fallback) }, { status })
}
