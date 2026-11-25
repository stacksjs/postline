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
import { UserFacingError } from './user-error'

export const GENERIC_FAILURE = 'Something went wrong on our side. Try again.'

const MAX_LENGTH = 300

/** Shapes that mean a message was not written for a person, whoever threw it. */
const INTERNAL = /\bSQLITE_|\bno such (?:table|column)\b|\bsyntax error\b|\bconstraint failed\b|\bis not a function\b|\bCannot read propert|\bundefined is not\b|\bECONN|\bENOENT\b|\bEACCES\b|\n\s+at /i

function writtenForPeople(error: unknown): error is Error {
  if (!(error instanceof Error))
    return false
  if (error instanceof UnsafeUrlError || error instanceof UserFacingError)
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

/** Whether a caught error's own message can be shown, as publicMessage decides. */
function isShowable(error: unknown): boolean {
  return writtenForPeople(error) && Boolean(error.message) && !INTERNAL.test(error.message)
}

/**
 * The JSON failure every Postline action returns: `{ ok: false, error, code }`.
 *
 * `code` is stable for a client to branch on: the error's own code when it
 * was written for the owner (`request_failed` unless it names one), and
 * `internal_error` when its message was withheld. A withheld error with no
 * fallback of the action's own is a fault on the server, so it answers 500.
 */
export function actionFailure(error: unknown, status: FailureStatus = 422, fallback = GENERIC_FAILURE): ReturnType<typeof response.json> {
  // With its own fallback, the action has said what went wrong and chosen the
  // status for it; only the generic one means an unexplained server fault.
  if (!isShowable(error))
    return response.json({ ok: false, error: publicMessage(error, fallback), code: 'internal_error' }, { status: fallback === GENERIC_FAILURE ? 500 : status })
  const code = error instanceof UserFacingError ? error.code : 'request_failed'
  return response.json({ ok: false, error: publicMessage(error, fallback), code }, { status })
}
